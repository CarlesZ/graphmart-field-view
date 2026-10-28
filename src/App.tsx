import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Boxes, ChevronDown, CircleHelp, Database, Download, Factory, Focus, Gauge, Layers3, LoaderCircle, Network, RefreshCw, Search, Share2, SlidersHorizontal, Truck, Wifi, X, Zap } from 'lucide-react'
import GraphCanvas from './GraphCanvas'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { GraphData, GraphEdge, Graphmart, GraphNode, SampleData } from './types'
import './dashboard.css'

const emptyGraph: GraphData = { nodes: [], edges: [] }
const emptySample: SampleData = { records: [], pairs: [] }

function App() {
  const [graphmarts, setGraphmarts] = useState<Graphmart[]>([])
  const [selectedGraphmart, setSelectedGraphmart] = useState('')
  const [graph, setGraph] = useState<GraphData>(emptyGraph)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [sample, setSample] = useState<SampleData>(emptySample)
  const [isLoadingSample, setIsLoadingSample] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const [inspectorWidth, setInspectorWidth] = useState(480)
  const explorerGridRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const [isLoadingGraphmarts, setIsLoadingGraphmarts] = useState(true)
  const [isLoadingGraph, setIsLoadingGraph] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<'checking' | 'connected' | 'offline'>('checking')

  async function loadGraphmarts() {
    setIsLoadingGraphmarts(true)
    setError('')
    try {
      const response = await fetch('/api/graphmarts')
      const payload = (await response.json()) as { graphmarts?: Graphmart[]; error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'GraphStudio could not be reached.')
      const nextGraphmarts = payload.graphmarts ?? []
      setGraphmarts(nextGraphmarts)
      setConnection('connected')
      setSelectedGraphmart((current) => current && nextGraphmarts.some((mart) => mart.uri === current)
        ? current
        : nextGraphmarts.find((mart) => mart.title === 'CarlesZ_GM')?.uri ?? nextGraphmarts[0]?.uri ?? '')
    } catch (loadError) {
      setConnection('offline')
      setError(loadError instanceof Error ? loadError.message : 'GraphStudio could not be reached.')
    } finally {
      setIsLoadingGraphmarts(false)
    }
  }

  async function loadGraph(graphmartUri: string) {
    if (!graphmartUri) return
    setIsLoadingGraph(true)
    setSelectedNode(null)
    setSelectedEdge(null)
    setError('')
    try {
      const params = new URLSearchParams({ graphmart: graphmartUri, limit: '35' })
      const response = await fetch(`/api/graph?${params}`)
      const payload = (await response.json()) as GraphData & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not load graph data.')
      setGraph({ nodes: payload.nodes ?? [], edges: payload.edges ?? [] })
    } catch (loadError) {
      setGraph(emptyGraph)
      setError(loadError instanceof Error ? loadError.message : 'Could not load graph data.')
    } finally {
      setIsLoadingGraph(false)
    }
  }

  useEffect(() => { void loadGraphmarts() }, [])
  useEffect(() => { void loadGraph(selectedGraphmart) }, [selectedGraphmart])
  useEffect(() => {
    if (!selectedGraphmart || (!selectedNode && !selectedEdge)) {
      setSample(emptySample)
      setIsLoadingSample(false)
      return
    }

    const params = new URLSearchParams({ graphmart: selectedGraphmart })
    if (selectedNode) {
      params.set('classUris', selectedNode.classUris.join('|'))
    } else if (selectedEdge) {
      params.set('predicateUri', selectedEdge.predicateUri)
      params.set('sourceClassUris', selectedEdge.sourceClassUris.join('|'))
      params.set('targetClassUris', selectedEdge.targetClassUris.join('|'))
    }

    let active = true
    setIsLoadingSample(true)
    setSampleError('')
    fetch(`/api/sample?${params}`)
      .then(async (response) => {
        const payload = (await response.json()) as Partial<SampleData> & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Could not load sample data.')
        return { records: payload.records ?? [], pairs: payload.pairs ?? [] }
      })
      .then((data) => { if (active) setSample(data) })
      .catch((loadError: unknown) => {
        if (active) setSampleError(loadError instanceof Error ? loadError.message : 'Could not load sample data.')
      })
      .finally(() => { if (active) setIsLoadingSample(false) })

    return () => { active = false }
  }, [selectedGraphmart, selectedNode, selectedEdge])

  const activeGraphmart = graphmarts.find((mart) => mart.uri === selectedGraphmart)
  const term = search.trim().toLowerCase()
  const visibleEdges = useMemo(() => term ? graph.edges.filter((edge) => `${edge.label} ${edge.sourceLabel} ${edge.targetLabel}`.toLowerCase().includes(term)) : graph.edges, [graph.edges, term])
  const visibleNodes = useMemo(() => {
    if (!term) return graph.nodes
    const linkedNodeIds = new Set(visibleEdges.flatMap((edge) => [edge.source, edge.target]))
    return graph.nodes.filter((node) => linkedNodeIds.has(node.id) || `${node.label} ${node.type}`.toLowerCase().includes(term))
  }, [graph.nodes, term, visibleEdges])
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const canvasData = useMemo(() => ({ nodes: visibleNodes, edges: visibleEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)) }), [visibleEdges, visibleNodeIds, visibleNodes])
  const classes = new Set(graph.nodes.map((node) => node.type).filter(Boolean))
  const sampleColumns = useMemo(() => [...new Set(sample.records.flatMap((record) => Object.keys(record.fields)))], [sample.records])

  function startInspectorResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const grid = explorerGridRef.current
    if (!grid) return
    const move = (moveEvent: PointerEvent) => {
      const rect = grid.getBoundingClientRect()
      setInspectorWidth(Math.round(Math.min(Math.max(rect.right - moveEvent.clientX, 300), rect.width - 320)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('is-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    document.body.classList.add('is-resizing')
  }
  function exportRelationships() {
    const rows = [['source', 'relationship', 'target'], ...visibleEdges.map((edge) => [edge.sourceLabel, edge.label, edge.targetLabel])]
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeGraphmart?.title ?? 'graphmart'}-relationships.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark"><Network size={20} strokeWidth={2.2} /></div><div><div className="brand-name">FIELD<span>/</span>VIEW</div><div className="brand-caption">GRAPH INTELLIGENCE</div></div></div>
        <div className="sidebar-section-label">Workspace</div>
        <button className="nav-item nav-item-active" type="button"><Share2 size={17} /><span>Graph explorer</span><span className="nav-pulse" /></button>
        <div className="sidebar-section-label mart-label"><span>Graphmarts</span><span className="count-chip">{graphmarts.length.toString().padStart(2, '0')}</span></div>
        <div className="mart-list">
          {isLoadingGraphmarts ? <div className="side-loading"><LoaderCircle className="spin" size={15} /> Connecting</div> : graphmarts.length ? graphmarts.slice(0, 8).map((mart) => (
            <button className={`mart-item ${selectedGraphmart === mart.uri ? 'mart-item-active' : ''}`} key={mart.uri} onClick={() => setSelectedGraphmart(mart.uri)} title={mart.title} type="button"><Database size={15} /><span>{mart.title}</span></button>
          )) : <div className="side-empty">No graphmarts found</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="server-card"><div className={`server-icon ${connection}`}><Wifi size={15} /></div><div className="server-copy"><span className="server-label">GraphStudio MCP</span><span className={`server-state ${connection}`}>{connection === 'connected' ? 'Connected' : connection === 'offline' ? 'Unavailable' : 'Connecting'}</span></div><span className={`state-dot ${connection}`} /></div>
          <div className="sidebar-footnote"><span>LOCAL DEMO</span><span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Graph explorer</strong></div><div className="topbar-actions"><span className="local-pill"><span />LOCAL SESSION</span><button className="icon-button help-button" title="About this local demo" type="button"><CircleHelp size={17} /></button></div></header>
        <div className="content-wrap">
          <section className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> GRAPH INTELLIGENCE / OVERVIEW</div><h1>Graph field</h1><p className="heading-subtitle">Inspect entities, relationships, and the structure behind your graphmart.</p></div>
            <div className="heading-controls">
              <label className="select-wrap"><Database size={16} /><select aria-label="Select graphmart" disabled={isLoadingGraphmarts || graphmarts.length === 0} onChange={(event) => setSelectedGraphmart(event.target.value)} value={selectedGraphmart}>{graphmarts.length === 0 && <option value="">Select graphmart</option>}{graphmarts.map((mart) => <option key={mart.uri} value={mart.uri}>{mart.title}</option>)}</select><ChevronDown size={15} className="select-chevron" /></label>
              <button className="button button-dark" disabled={!selectedGraphmart || isLoadingGraph} onClick={() => void loadGraph(selectedGraphmart)} type="button"><RefreshCw size={15} className={isLoadingGraph ? 'spin' : ''} />Refresh</button>
            </div>
          </section>

          {error && <div className="error-banner" role="alert"><span><Zap size={16} /> {error}</span><button className="icon-button" onClick={() => setError('')} title="Dismiss message" type="button"><X size={15} /></button></div>}

          <section className="metric-row" aria-label="Graphmart metrics">
            <article className="metric-cell metric-highlight"><div className="metric-top"><span>Ontology classes</span><Boxes size={16} /></div><div className="metric-value">{isLoadingGraph ? '—' : graph.nodes.length.toLocaleString()}</div><div className="metric-foot"><span className="metric-accent-bar" />Classes in this view</div></article>
            <article className="metric-cell"><div className="metric-top"><span>Ontology edges</span><Activity size={16} /></div><div className="metric-value">{isLoadingGraph ? '—' : graph.edges.length.toLocaleString()}</div><div className="metric-foot">Directed class relationships</div></article>
            <article className="metric-cell"><div className="metric-top"><span>Relationship types</span><Layers3 size={16} /></div><div className="metric-value">{isLoadingGraph ? '—' : classes.size.toString().padStart(2, '0')}</div><div className="metric-foot">Distinct object properties</div></article>
            <article className="metric-cell metric-engine"><div className="metric-top"><span>Query engine</span><Gauge size={16} /></div><div className="engine-value"><span className="engine-mark">AG</span><span>ANZOGRAPH</span></div><div className="metric-foot"><span className="live-dot" />{connection === 'connected' ? 'MCP connection active' : 'Waiting for GraphStudio'}</div></article>
          </section>

          <section className="explorer-heading"><div className="section-title-wrap"><div className="section-kicker">01 / ONTOLOGY MAP</div><h2>Classes &amp; relationships</h2></div><div className="explorer-tools"><label className="search-box"><Search size={16} /><input aria-label="Filter ontology" onChange={(event) => setSearch(event.target.value)} placeholder="Filter classes or properties" value={search} />{search && <button className="clear-search" onClick={() => setSearch('')} title="Clear search" type="button"><X size={13} /></button>}</label><button className="button button-outline" disabled={!graph.edges.length} onClick={exportRelationships} type="button"><Download size={15} />Export</button></div></section>

          <section className="explorer-grid" ref={explorerGridRef} style={{ gridTemplateColumns: `minmax(0, 1fr) 8px ${inspectorWidth}px` }}>
            <div className="graph-panel">
              <div className="graph-panel-head"><div className="graph-panel-title"><span className="live-dot" />{activeGraphmart?.title ?? 'Graphmart not selected'}<span className="panel-divider">/</span><span className="panel-muted">{canvasData.edges.length} visible edges</span></div><div className="graph-tools-label"><SlidersHorizontal size={14} /> SCHEMA VIEW</div></div>
              <div className="graph-canvas-wrap">
                {isLoadingGraph ? <div className="canvas-state"><LoaderCircle className="spin" size={24} /><span>Reading ontology edges</span></div> : canvasData.nodes.length ? <GraphCanvas data={canvasData} onSelect={setSelectedNode} onSelectEdge={setSelectedEdge} selectedId={selectedNode?.id ?? ''} selectedEdgeId={selectedEdge?.id ?? ''} /> : (
                  <div className="canvas-state canvas-empty"><div className="empty-glyph"><Network size={26} /></div><strong>{connection === 'connected' ? 'No ontology edges found' : 'Waiting for GraphStudio'}</strong><span>{connection === 'connected' ? 'Choose a graphmart with a registered ontology.' : 'Check the MCP server connection in .vscode/mcp.json.'}</span>{connection === 'offline' && <button className="button button-dark" onClick={() => void loadGraphmarts()} type="button"><RefreshCw size={14} />Retry connection</button>}</div>
                )}
                <div className="canvas-corner canvas-corner-tl" /><div className="canvas-corner canvas-corner-br" />
              </div>
              <div className="graph-legend"><span className="legend-label">ENTITY KEY</span><span><i className="legend-dot plant-dot" />Plant</span><span><i className="legend-dot line-dot" />Production line</span><span><i className="legend-dot part-dot" />Part</span><span><i className="legend-dot supplier-dot" />Supplier</span><button className="fit-button" onClick={() => window.dispatchEvent(new CustomEvent('graph:fit'))} title="Fit graph to view" type="button"><Focus size={14} />Fit</button></div>
            </div>

            <div aria-label="Resize sample data panel" aria-orientation="vertical" className="panel-splitter" onPointerDown={startInspectorResize} role="separator" title="Drag to resize" />

            <aside className="inspector-panel">
              <div className="inspector-head"><div><div className="section-kicker">02 / SAMPLE DATA</div><h3>{selectedNode ? 'Ontology class' : selectedEdge ? 'Ontology edge' : 'Sample inspector'}</h3></div><span className="inspector-index">{selectedNode || selectedEdge ? 'ACTIVE' : '—'}</span></div>
              {selectedNode || selectedEdge ? <div className="entity-detail">
                <div className="entity-summary">
                  <div className={`entity-avatar ${selectedNode?.category ?? 'other'}`}>{selectedNode?.category === 'plant' ? <Factory size={21} /> : selectedNode?.category === 'line' ? <Activity size={21} /> : selectedNode?.category === 'part' ? <Boxes size={21} /> : selectedNode?.category === 'supplier' ? <Truck size={21} /> : <Database size={21} />}</div>
                  <div className="entity-heading"><span className="type-label">{selectedNode ? selectedNode.type : 'OBJECT PROPERTY'}</span><h4>{selectedNode?.label ?? `${selectedEdge?.sourceLabel} → ${selectedEdge?.label} → ${selectedEdge?.targetLabel}`}</h4></div>
                </div>
                <div className="detail-key">{selectedNode ? 'CLASS URI' : 'PROPERTY URI'}</div><div className="uri-value" title={selectedNode?.id ?? selectedEdge?.predicateUri}>{selectedNode?.id ?? selectedEdge?.predicateUri}</div>
                <div className="sample-card"><div className="sample-card-head"><span>{selectedNode ? 'SAMPLE RECORDS · ALL FIELDS' : 'LINKED RECORDS · ALL FIELDS'}</span><span>{selectedNode ? `${sample.records.length} RECORDS × ${sampleColumns.length} FIELDS` : `${sample.pairs.length} PAIRS`}</span></div>
                  {isLoadingSample ? <div className="sample-state"><LoaderCircle className="spin" size={15} /> Loading sample</div> : sampleError ? <p className="sample-state sample-error">{sampleError}</p> : selectedNode ? (sample.records.length ? (
                    <table className="sample-table"><thead><tr><th>RECORD</th>{sampleColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
                      {sample.records.map((record) => <tr key={record.id}><td>{record.id}</td>{sampleColumns.map((column) => <td key={column} title={record.fields[column] ?? ''}>{record.fields[column] ?? '—'}</td>)}</tr>)}
                    </tbody></table>
                  ) : <p className="sample-state">No sample values found.</p>) : sample.pairs.length ? sample.pairs.map((pair) => (
                    <div className="sample-pair" key={`${pair.source.id}|${pair.target.id}`}>
                      <div className="sample-pair-head"><strong>{pair.source.id}</strong><span>{selectedEdge?.label} →</span><strong>{pair.target.id}</strong></div>
                      <div className="sample-pair-grid">
                        {[pair.source, pair.target].map((record, index) => (
                          <div className="field-list" key={index}>
                            <div className="field-list-title"><span>{index ? 'TARGET' : 'SOURCE'} · {record.id}</span><span>{Object.keys(record.fields).length} FIELDS</span></div>
                            {Object.entries(record.fields).map(([field, value]) => <div className="field-row" key={field}><span>{field}</span><strong>{value}</strong></div>)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )) : <p className="sample-state">No linked records found.</p>}
                </div>
              </div> : <div className="inspector-empty"><div className="empty-ring"><Network size={20} /></div><p>Select a class or ontology edge to view sample data.</p></div>}
              <div className="inspector-foot"><span><span className="tiny-dot" />SOURCE</span><strong>{activeGraphmart?.title ?? '—'}</strong></div>
            </aside>
          </section>

          <section className="relationship-section"><div className="relationship-heading"><div><div className="section-kicker">03 / ONTOLOGY EDGES</div><h2>Relationship index</h2></div><span className="result-count">{visibleEdges.length} ROWS</span></div>
            <div className="table-wrap"><table><thead><tr><th>DOMAIN CLASS</th><th>OBJECT PROPERTY</th><th>RANGE CLASS</th><th className="table-end">INSTANCES</th></tr></thead><tbody>
              {visibleEdges.slice(0, 12).map((edge) => <tr key={edge.id}><td><button className="table-entity" onClick={() => { setSelectedNode(graph.nodes.find((node) => node.id === edge.source) ?? null); setSelectedEdge(null) }} type="button"><span className={`table-dot ${graph.nodes.find((node) => node.id === edge.source)?.category ?? 'other'}`} />{edge.sourceLabel}</button></td><td><button className="predicate-cell predicate-select" onClick={() => { setSelectedEdge(edge); setSelectedNode(null) }} type="button">{edge.label}</button></td><td><button className="table-entity" onClick={() => { setSelectedNode(graph.nodes.find((node) => node.id === edge.target) ?? null); setSelectedEdge(null) }} type="button"><span className={`table-dot ${graph.nodes.find((node) => node.id === edge.target)?.category ?? 'other'}`} />{edge.targetLabel}</button></td><td className="table-end"><span className="type-tag">{edge.instances.toLocaleString()}</span></td></tr>)}
              {!visibleEdges.length && <tr><td className="table-empty" colSpan={4}>No matching relationships in the current sample.</td></tr>}
            </tbody></table></div>
          </section>
          <footer className="page-footer"><span>FIELD/VIEW <span className="footer-sep">•</span> GRAPHMART INSPECTOR</span><span>{activeGraphmart?.title ?? 'NO GRAPHMART'} <span className="footer-sep">/</span> LOCAL DEMO</span></footer>
        </div>
      </main>
    </div>
  )
}

export default App
