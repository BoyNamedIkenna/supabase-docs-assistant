// A tiny Markdown plugin: turns [1], [2] ... in the answer text into links to the matching source.
// It only touches ordinary text, so code blocks and `inline code` (where [1] can mean an array index) stay as they are.

interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
}

export function splitCitations(text: string, urlFor: (n: number) => string | undefined): MdNode[] {
  const out: MdNode[] = []
  let last = 0
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const url = urlFor(Number(m[1]))
    if (!url) continue // [9] with no source 9 stays plain text
    const start = m.index
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) })
    out.push({ type: 'link', url, children: [{ type: 'text', value: `[${m[1]}]` }] })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out.length ? out : [{ type: 'text', value: text }]
}

function walk(node: MdNode, urlFor: (n: number) => string | undefined) {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      next.push(...splitCitations(child.value, urlFor))
    } else {
      if (child.type !== 'link') walk(child, urlFor) // never put a link inside a link
      next.push(child)
    }
  }
  node.children = next
}

export const remarkCitations = (urlFor: (n: number) => string | undefined) => () => (tree: MdNode) => {
  walk(tree, urlFor)
}