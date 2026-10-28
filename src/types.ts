export type Graphmart = { uri: string; title: string; description?: string }

export type GraphNode = {
  id: string
  label: string
  type: string
  category: 'plant' | 'line' | 'part' | 'supplier' | 'other'
  classUris: string[]
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  sourceLabel: string
  targetLabel: string
  targetType: string
  label: string
  predicateUri: string
  sourceClassUris: string[]
  targetClassUris: string[]
  instances: number
}

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] }

export type SampleRecord = { id: string; fields: Record<string, string> }

export type SampleData = {
  records: SampleRecord[]
  pairs: Array<{ source: SampleRecord; target: SampleRecord }>
}