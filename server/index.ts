import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse as parseCsv } from 'csv-parse/sync'
import express from 'express'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

if (existsSync('.env')) process.loadEnvFile('.env')

type GraphStudioServerConfig = {
  url?: string
  headers?: Record<string, string>
}

type McpConfig = {
  servers?: Record<string, GraphStudioServerConfig>
  mcpServers?: Record<string, GraphStudioServerConfig>
}

type McpResult = {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type?: string; text?: string }>
}

type Row = Record<string, unknown>

function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return text
  }
}

function parseTextTable(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim())
  const headerIndex = lines.findIndex((line) => line.trimStart().startsWith('?') || line.trimStart().startsWith('|'))
  if (headerIndex < 0) return []
  const split = (line: string) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) return trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
    return trimmed.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean)
  }
  const headers = split(lines[headerIndex]).map((header) => header.replace(/^\?/, ''))
  const rows: Row[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^[\s|:+-]+$/.test(line)) continue
    const values = split(line)
    if (values.length < 2) continue
    const row: Row = {}
    headers.forEach((header, index) => { row[header] = values[index] ?? '' })
    rows.push(row)
  }
  return rows
}

function parseCsvText(text: string): Row[] {
  const content = text.split(/\r?\n---\r?\n/, 1)[0]
  return parseCsv(content, { columns: true, bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true }) as Row[]
}

function unwrapMcpResult(result: McpResult): unknown {
  if (result.isError) {
    const message = result.content?.map((item) => item.text ?? '').filter(Boolean).join('\n')
    throw new Error(message || 'The GraphStudio MCP tool returned an error.')
  }
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? ''
  return parseJsonText(text.split(/\r?\n---\r?\n/, 1)[0])
}

function asRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((row): row is Row => typeof row === 'object' && row !== null)
  if (typeof value === 'string') {
    const parsed = parseJsonText(value)
    if (typeof parsed !== 'string') return asRows(parsed)
    if (value.trimStart().startsWith('"') && value.includes('\n')) return parseCsvText(value)
    const graphmarts = value.split(/(?:\[|,\s*)class Graphmart \{/).slice(1).map((body) => {
      const row: Row = {}
      for (const line of body.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
        if (match) row[match[1]] = match[2]
      }
      return row
    })
    return graphmarts.length ? graphmarts : parseTextTable(value)
  }
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  // GraphStudio cuts oversized results mid-row; keep only complete lines.
  if (typeof record.content === 'string') return asRows(record._truncated ? record.content.slice(0, record.content.lastIndexOf('\n')) : record.content)
  for (const key of ['graphmarts', 'items', 'rows', 'data']) {
    if (Array.isArray(record[key])) return asRows(record[key])
  }
  if (typeof record.results === 'object' && record.results !== null && Array.isArray((record.results as Record<string, unknown>).bindings)) {
    return (record.results as { bindings: Row[] }).bindings
  }
  return []
}

function bindingValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value !== null && 'value' in value) return String((value as { value: unknown }).value ?? '')
  return ''
}

function localName(value: string): string {
  const tail = value.split(/[/#]/).pop() || value
  try {
    return decodeURIComponent(tail).replaceAll('_', ' ')
  } catch {
    return tail.replaceAll('_', ' ')
  }
}

function categoryFor(type: string): 'plant' | 'line' | 'part' | 'supplier' | 'other' {
  const normalized = type.toLowerCase()
  if (normalized.includes('plant')) return 'plant'
  if (normalized.includes('productionline') || normalized.includes('production line')) return 'line'
  if (normalized.includes('part')) return 'part'
  if (normalized.includes('supplier')) return 'supplier'
  return 'other'
}

const ontologyNamespace = 'http://siemens.com/IndustrialOntology/CZ2_ManufacturingPartsProduction#'
const instanceNamespace = 'http://example.com/manufacturing/bom/'

function displayClass(uri: string): string {
  const name = localName(uri)
  return name === 'MakePart' || name === 'BuyPart' ? 'Part' : name
}

function canonicalClassUri(uri: string): string {
  return displayClass(uri) === 'Part' ? `${ontologyNamespace}Part` : uri
}

function propertyName(uri: string): string {
  return localName(uri).split('.').pop() ?? uri
}

function validClassUris(value: string): string[] {
  return value.split('|').filter((uri) => uri.startsWith(ontologyNamespace) && /^[A-Za-z][A-Za-z0-9]*$/.test(uri.slice(ontologyNamespace.length)))
}

async function loadServerConfig(): Promise<{ url: string; headers: Record<string, string> }> {
  const envUrl = process.env.GRAPHSTUDIO_MCP_URL
  if (envUrl) {
    const { GRAPHSTUDIO_USER: user, GRAPHSTUDIO_PASSWORD: password } = process.env
    const headers: Record<string, string> = user && password ? { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` } : {}
    return { url: envUrl, headers }
  }
  const configPath = process.env.GRAPHSTUDIO_MCP_CONFIG ?? resolve(process.cwd(), '.vscode/mcp.json')
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as McpConfig
  const servers = raw.servers ?? raw.mcpServers ?? {}
  const preferredName = process.env.GRAPHSTUDIO_MCP_SERVER ?? 'graph-tt02-alt'
  const chosen = servers[preferredName] ?? Object.values(servers).find((server) => server.url)
  if (!chosen?.url) throw new Error(`No GraphStudio HTTP MCP server was found in ${configPath}.`)
  return { url: chosen.url, headers: chosen.headers ?? {} }
}

async function withGraphStudio<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const server = await loadServerConfig()
  const client = new Client({ name: 'graphmart-field-view', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers },
  })
  try {
    await client.connect(transport)
    return await work(client)
  } finally {
    await transport.terminateSession().catch(() => undefined)
    await client.close().catch(() => undefined)
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { tools } = await client.listTools()
  const target = tools.some((tool) => tool.name === name) ? name : tools.some((tool) => tool.name === 'tools') ? 'tools' : ''
  if (!target) throw new Error('The GraphStudio MCP endpoint does not expose a compatible dispatcher.')
  const argumentsValue = target === name ? args : { action: 'execute', toolName: name, arguments: args }
  const result = await client.callTool({ name: target, arguments: argumentsValue }) as McpResult
  return unwrapMcpResult(result)
}

const app = express()
app.disable('x-powered-by')

app.get('/api/health', async (_request, response) => {
  try {
    const tools = await withGraphStudio(async (client) => (await client.listTools()).tools)
    response.json({ connected: true, server: 'GraphStudio MCP', toolCount: tools.length })
  } catch {
    response.status(502).json({ connected: false, error: 'Could not connect to GraphStudio MCP. Check the local MCP config and server availability.' })
  }
})

app.get('/api/graphmarts', async (_request, response) => {
  try {
    const value = await withGraphStudio((client) => callTool(client, 'rest_listGraphmarts', { limit: 25, sort: 'title' }))
    const graphmarts = asRows(value).map((row) => ({
      uri: bindingValue(row.uri ?? row.graphmart ?? row['?uri']),
      title: bindingValue(row.title ?? row['?title']),
      description: bindingValue(row.description ?? row['?description']),
    })).filter((mart) => mart.uri && mart.title)
    response.json({ graphmarts })
  } catch {
    response.status(502).json({ error: 'Could not list graphmarts through GraphStudio MCP. Check the local MCP config and server availability.' })
  }
})

app.get('/api/graph', async (request, response) => {
  const graphmart = String(request.query.graphmart ?? '')
  if (!graphmart) {
    response.status(400).json({ error: 'Select a graphmart before loading the graph.' })
    return
  }

  const query = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?sourceClass ?predicate ?targetClass (COUNT(DISTINCT ?subject) AS ?instances)
WHERE {
  ?subject rdf:type ?sourceClass ; ?predicate ?object .
  ?object rdf:type ?targetClass .
  FILTER(STRSTARTS(STR(?sourceClass), "${ontologyNamespace}"))
  FILTER(STRSTARTS(STR(?targetClass), "${ontologyNamespace}"))
  FILTER(STRSTARTS(STR(?predicate), "${ontologyNamespace}"))
}
GROUP BY ?sourceClass ?predicate ?targetClass
ORDER BY ?sourceClass ?predicate ?targetClass
LIMIT 40`

  try {
    const value = await withGraphStudio((client) => callTool(client, 'rest_query', { query, graphmartUriOrName: graphmart, format: 'csv' }))
    const rows = asRows(value)
    const nodes = new Map<string, { id: string; label: string; type: string; category: 'plant' | 'line' | 'part' | 'supplier' | 'other'; classUris: string[] }>()
    const edges = new Map<string, { id: string; source: string; target: string; sourceLabel: string; targetLabel: string; targetType: string; label: string; predicateUri: string; sourceClassUris: string[]; targetClassUris: string[]; instances: number }>()

    for (const row of rows) {
      const sourceClassUri = bindingValue(row.sourceClass ?? row['?sourceClass'])
      const targetClassUri = bindingValue(row.targetClass ?? row['?targetClass'])
      const predicate = bindingValue(row.predicate ?? row['?predicate'])
      if (!sourceClassUri || !targetClassUri || !predicate) continue
      const source = canonicalClassUri(sourceClassUri)
      const target = canonicalClassUri(targetClassUri)
      const sourceLabel = displayClass(sourceClassUri)
      const targetLabel = displayClass(targetClassUri)
      const sourceNode = nodes.get(source) ?? { id: source, label: sourceLabel, type: sourceLabel, category: categoryFor(sourceLabel), classUris: [] }
      const targetNode = nodes.get(target) ?? { id: target, label: targetLabel, type: targetLabel, category: categoryFor(targetLabel), classUris: [] }
      if (!sourceNode.classUris.includes(sourceClassUri)) sourceNode.classUris.push(sourceClassUri)
      if (!targetNode.classUris.includes(targetClassUri)) targetNode.classUris.push(targetClassUri)
      nodes.set(source, sourceNode)
      nodes.set(target, targetNode)
      const id = `${source}|${predicate}|${target}`
      const edge = edges.get(id) ?? { id, source, target, sourceLabel, targetLabel, targetType: targetLabel, label: propertyName(predicate), predicateUri: predicate, sourceClassUris: [], targetClassUris: [], instances: 0 }
      if (!edge.sourceClassUris.includes(sourceClassUri)) edge.sourceClassUris.push(sourceClassUri)
      if (!edge.targetClassUris.includes(targetClassUri)) edge.targetClassUris.push(targetClassUri)
      edge.instances = Math.max(edge.instances, Number(bindingValue(row.instances ?? row['?instances'])) || 0)
      edges.set(id, edge)
    }

    response.json({ nodes: [...nodes.values()], edges: [...edges.values()], sampledRows: rows.length })
  } catch {
    response.status(502).json({ error: 'Could not query this graphmart through GraphStudio MCP. Confirm that it is available and deployed.' })
  }
})

app.get('/api/sample', async (request, response) => {
  const graphmart = String(request.query.graphmart ?? '')
  const classUris = validClassUris(String(request.query.classUris ?? ''))
  const predicateUri = String(request.query.predicateUri ?? '')
  const sourceClassUris = validClassUris(String(request.query.sourceClassUris ?? ''))
  const targetClassUris = validClassUris(String(request.query.targetClassUris ?? ''))
  const validPredicate = /^[A-Za-z][\w.]*$/.test(predicateUri.slice(ontologyNamespace.length)) && predicateUri.startsWith(ontologyNamespace)
  if (!graphmart || (!classUris.length && (!validPredicate || !sourceClassUris.length || !targetClassUris.length))) {
    response.status(400).json({ error: 'Select an ontology class or relationship to load a sample.' })
    return
  }

  const typeUri = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  const values = (variable: string, uris: string[]) => `VALUES ?${variable} { ${uris.map((uri) => `<${uri}>`).join(' ')} }`
  // Short ids and field names keep the CSV under GraphStudio's MCP output limit.
  const fieldsQuery = (recordPattern: string) => `SELECT ?rid ?field ?value
WHERE {
  ${recordPattern}
  ?record ?property ?value .
  FILTER(isLiteral(?value))
  FILTER(STRSTARTS(STR(?property), "${ontologyNamespace}"))
  BIND(STRAFTER(STR(?record), "${instanceNamespace}") AS ?rid)
  BIND(STRAFTER(STRAFTER(STR(?property), "#"), ".") AS ?field)
}
ORDER BY ?rid ?field`
  const groupFields = (rows: Row[]) => {
    const records = new Map<string, Record<string, string>>()
    for (const row of rows) {
      const rid = bindingValue(row.rid)
      const field = bindingValue(row.field)
      if (!rid || !field) continue
      const fields = records.get(rid) ?? {}
      const fieldValue = bindingValue(row.value)
      fields[field] = fields[field] && !fields[field].split(', ').includes(fieldValue) ? `${fields[field]}, ${fieldValue}` : fieldValue
      records.set(rid, fields)
    }
    return records
  }
  const recordLabel = (rid: string) => {
    try {
      return decodeURIComponent(rid).replace('/', ' ')
    } catch {
      return rid.replace('/', ' ')
    }
  }
  const isSafeId = (id: string) => /^[\w%.\-/]+$/.test(id)

  try {
    const data = await withGraphStudio(async (client) => {
      const runCsv = async (query: string) => asRows(await callTool(client, 'rest_query', { query, graphmartUriOrName: graphmart, format: 'csv' }))
      if (classUris.length) {
        const records = groupFields(await runCsv(fieldsQuery(`{ SELECT DISTINCT ?record WHERE { ${values('class', classUris)} ?record <${typeUri}> ?class . FILTER(STRSTARTS(STR(?record), "${instanceNamespace}")) } ORDER BY ?record LIMIT 5 }`)))
        return { records: [...records].map(([id, fields]) => ({ id: recordLabel(id), fields })), pairs: [] }
      }

      const pairs = (await runCsv(`SELECT DISTINCT ?sid ?tid
WHERE {
  ${values('sourceClass', sourceClassUris)}
  ${values('targetClass', targetClassUris)}
  ?source <${typeUri}> ?sourceClass ; <${predicateUri}> ?target .
  ?target <${typeUri}> ?targetClass .
  FILTER(STRSTARTS(STR(?source), "${instanceNamespace}"))
  FILTER(STRSTARTS(STR(?target), "${instanceNamespace}"))
  BIND(STRAFTER(STR(?source), "${instanceNamespace}") AS ?sid)
  BIND(STRAFTER(STR(?target), "${instanceNamespace}") AS ?tid)
}
ORDER BY ?sid ?tid
LIMIT 3`))
        .map((row) => ({ sid: bindingValue(row.sid), tid: bindingValue(row.tid) }))
        .filter((pair) => isSafeId(pair.sid) && isSafeId(pair.tid))
      if (!pairs.length) return { records: [], pairs: [] }

      const ids = [...new Set(pairs.flatMap((pair) => [pair.sid, pair.tid]))]
      const records = groupFields(await runCsv(fieldsQuery(`VALUES ?record { ${ids.map((id) => `<${instanceNamespace}${id}>`).join(' ')} }`)))
      const toRecord = (id: string) => ({ id: recordLabel(id), fields: records.get(id) ?? {} })
      return { records: [], pairs: pairs.map((pair) => ({ source: toRecord(pair.sid), target: toRecord(pair.tid) })) }
    })
    response.json(data)
  } catch {
    response.status(502).json({ error: 'Could not load sample data from this graphmart.' })
  }
})

const port = Number.parseInt(process.env.API_PORT ?? '4174', 10)
app.listen(port, '127.0.0.1', () => {
  console.log(`GraphStudio bridge listening on http://127.0.0.1:${port}`)
})