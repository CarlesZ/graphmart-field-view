import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import type { GraphData, GraphEdge, GraphNode } from './types'

type GraphCanvasProps = {
  data: GraphData
  selectedId: string
  selectedEdgeId: string
  onSelect: (node: GraphNode | null) => void
  onSelectEdge: (edge: GraphEdge | null) => void
}

function GraphCanvas({ data, selectedId, selectedEdgeId, onSelect, onSelectEdge }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Core | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const graph = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((node) => ({ data: { id: node.id, label: node.label, type: node.type, category: node.category, classUris: node.classUris }, classes: node.category })),
        ...data.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, instances: edge.instances } })),
      ],
      layout: { name: 'circle', animate: false, fit: true, padding: 70 },
      minZoom: 0.18,
      maxZoom: 2.4,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-family': 'Space Grotesk, sans-serif', 'font-size': 14, color: '#28352e', 'text-wrap': 'ellipsis', 'text-max-width': '160px', 'text-valign': 'bottom', 'text-margin-y': 8, width: '44px', height: '44px', 'background-color': '#7b8a80', 'border-width': '2px', 'border-color': '#f5f7f1', 'overlay-opacity': 0 } },
        { selector: 'node.plant', style: { width: '54px', height: '54px', 'background-color': '#df8050', 'border-color': '#ffe1cc' } },
        { selector: 'node.line', style: { width: '50px', height: '50px', 'background-color': '#8aa647', 'border-color': '#e5f0c1' } },
        { selector: 'node.part', style: { width: '54px', height: '54px', 'background-color': '#4d91a0', 'border-color': '#d6f0ef' } },
        { selector: 'node.supplier', style: { width: '50px', height: '50px', 'background-color': '#788275', 'border-color': '#dce4d9' } },
        { selector: 'edge', style: { width: 1.6, 'line-color': '#9ca89c', 'target-arrow-color': '#819285', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 1, label: 'data(label)', 'font-family': 'DM Mono, monospace', 'font-size': '11px', color: '#45544a', 'text-background-color': '#f5f7f1', 'text-background-opacity': 0.94, 'text-background-padding': '3px', 'text-rotation': 'autorotate', 'overlay-opacity': 0 } },
        { selector: 'node:selected', style: { 'border-width': '4px', 'border-color': '#19231e', 'overlay-color': '#d8ef7c', 'overlay-opacity': 0.22, 'overlay-padding': '8px' } },
        { selector: 'edge:selected', style: { width: 2.4, 'line-color': '#29362e', 'target-arrow-color': '#29362e' } },
      ],
    })
    graphRef.current = graph
    graph.on('tap', 'node', (event) => {
      const data = event.target.data()
      onSelect({ id: data.id, label: data.label, type: data.type, category: data.category, classUris: data.classUris })
      onSelectEdge(null)
    })
    graph.on('tap', 'edge', (event) => {
      const selectedEdge = data.edges.find((edge) => edge.id === event.target.id())
      if (selectedEdge) onSelectEdge(selectedEdge)
      onSelect(null)
    })
    graph.on('tap', (event) => { if (event.target === graph) { onSelect(null); onSelectEdge(null) } })
    const fitGraph = () => graph.fit(undefined, 48)
    window.addEventListener('graph:fit', fitGraph)
    const resizeObserver = new ResizeObserver(() => {
      graph.resize()
      fitGraph()
    })
    resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('graph:fit', fitGraph)
      graph.destroy()
      graphRef.current = null
    }
  }, [data.nodes, data.edges, onSelect, onSelectEdge])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.nodes().unselect()
    graph.edges().unselect()
    if (selectedId) graph.getElementById(selectedId).select()
    if (selectedEdgeId) graph.getElementById(selectedEdgeId).select()
  }, [selectedId, selectedEdgeId, data.nodes, data.edges])

  return <div aria-label="Interactive entity relationship map" className="graph-canvas" ref={containerRef} role="img" />
}

export default GraphCanvas