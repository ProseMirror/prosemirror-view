const {DOMSerializer} = require("prosemirror-model")

class NodeView {
  constructor(parent, node, outerDeco, innerDeco) {
    this.parent = parent
    this.contentDOM = null
    let serializer = DOMSerializer.fromSchema(node.type.schema) // FIXME
    this.dom = serializer.serializeNodeAndMarks(node, {onContent: (_, dom) => { this.contentDOM = dom }})
    this.dom.pmView = this
    if (node.isLeaf) {
      this.children = nothing
    } else {
      this.children = NodeView.buildChildren(this, node.content, innerDeco)
      NodeView.flushChildren(this.contentDOM, this.children)
    }
  }

  static buildChildren(parent, fragment, deco) {
    let result = []
    fragment.forEach((child, offset) => {
      let childView = new NodeView(parent, child, nothing, deco.forChild(offset, child))
      result.push(childView)
    })
    return result
  }

  update(node, prevNode, outerDeco, innerDeco) {
    if (!node.sameMarkup(prevNode) || (node.isText && node.text != prevNode.text)) return false
    if (!node.isLeaf) {
      NodeView.updateChildren(this, this.children, node.content, prevNode.content)
      NodeView.flushChildren(this.contentDOM, this.children)
    }
    return true
  }

  static destroyBetween(children, start, end) {
    if (start == end) return
    for (let i = start; i < end; i++) children[i].destroy()
    children.splice(start, end - start)
  }

  static updateChildren(parent, children, fragment, prevFragment) {
    let matching = pairNodes(fragment, prevFragment)
    let prevI = 0, i = 0
    for (let mI = 0; i < fragment.childCount; i++) {
      if (matching[mI] == i) { // There is a matching child in prevNode
        let skip = matching[mI + 1] - prevI
        NodeView.destroyBetween(children, i, i + skip)
        prevI += skip + 1
        mI += 2
      } else if (i < children.length && children[i].update(fragment.child(i), prevFragment.child(prevI))) {
        prevI++
      } else {
        children.splice(i, 0, new NodeView(parent, fragment.child(i)))
      }
    }
    NodeView.destroyBetween(children, i, children.length)
    return children
  }

  static flushChildren(parentDOM, children) {
    let dom = parentDOM.firstChild
    for (let i = 0; i < children.length; i++) {
      let childDOM = children[i].dom
      if (childDOM.parentNode == parentDOM) {
        while (childDOM != dom) dom = rm(dom)
        dom = dom.nextSibling
      } else {
        parentDOM.insertBefore(childDOM, dom)
      }
    }
    while (dom) dom = rm(dom)
  }

  destroy() {
    for (let i = 0; i < this.children.length; i++)
      this.children[i].destroy()
  }

  get size() { return this.node.nodeSize }
}
exports.NodeView = NodeView

function rm(dom) {
  let next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

function sameOuterDeco(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++)
    if (!a[i].sameOutput(b[i])) return false
  return true
}

const nothing = []

class DecoIter {
  constructor(locals) {
    this.locals = locals
    this.index = 0
  }

  at(offset) {
    return this.between(offset - 1, offset + 1)
  }

  between(start, end) {
    let result
    for (let i = this.index; i < this.locals.length; i++) {
      let span = this.locals[i]
      if (span.from >= end) break
      if (span.to < end && this.index == i) this.index = i + 1
      if (span.to > start) (result || (result = [])).push(span)
    }
    return result || nothing
  }
}

const SCAN_DIST = 5

// : (Fragment, Fragment) → [number]
// This is a crude, non-optimal (but with relatively low complexity
// bounds) longest common subsequence algorithm that returns an array
// of indices, where each pair of indices refer to a matched pair of
// nodes.
function pairNodes(a, b) {
  let lenA = a.childCount, lenB = b.childCount, dLen = lenA - lenB
  let maxA = Math.max(0, dLen) + SCAN_DIST, maxB = Math.max(0, -dLen) + SCAN_DIST
  let path = []
  for (let iA = 0, iB = 0; iA < lenA && iB < lenB; iA++, iB++) {
    // The distances that we can scan ahead on both sides.
    let nodeA = a.child(iA), nodeB = b.child(iB), found = false
    if (nodeA.eq(nodeB)) {
      found = true
    } else {
      let distA = Math.min(maxA, lenA - iA), distB = Math.min(maxB, lenB - iB)
      for (let dist = 1, maxDist = Math.max(distA, distB); !found && dist < maxDist; dist++) {
        if (dist < distA && nodeB.eq(a.child(iA + dist))) {
          iA += dist
          found = true
        } else if (dist < distB && nodeA.eq(b.child(iB + dist))) {
          iB += dist
          found = true
        }
      }
    }
    if (found) path.push(iA, iB)
  }
  return path
}
