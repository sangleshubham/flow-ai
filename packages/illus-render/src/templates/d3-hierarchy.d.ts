// Minimal types for the parts of d3-hierarchy 3.1.2 the templates use (the package ships none, and
// @types/d3-hierarchy is not in spec §19).
declare module 'd3-hierarchy' {
  export interface HierarchyNode<T> {
    data: T
    depth: number
    parent: HierarchyNode<T> | null
    children?: HierarchyNode<T>[]
    descendants(): HierarchyNode<T>[]
  }
  export interface HierarchyPointNode<T> extends HierarchyNode<T> {
    x: number
    y: number
    parent: HierarchyPointNode<T> | null
    children?: HierarchyPointNode<T>[]
    descendants(): HierarchyPointNode<T>[]
  }
  export interface TreeLayout<T> {
    (root: HierarchyNode<T>): HierarchyPointNode<T>
    nodeSize(size: [number, number]): TreeLayout<T>
    separation(fn: (a: HierarchyPointNode<T>, b: HierarchyPointNode<T>) => number): TreeLayout<T>
  }
  export function hierarchy<T>(data: T, children?: (d: T) => readonly T[] | undefined): HierarchyNode<T>
  export function tree<T>(): TreeLayout<T>
}
