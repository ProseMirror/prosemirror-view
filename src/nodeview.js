const {DOMSerializer} = require("prosemirror-model")

class WidgetView {
  constructor(parent, widget) {
    this.parent = parent
    this.children = nothing
    this.dom = widget.type.widget
  }
}

class MarkView {
  constructor(parent, mark) {
    this.parent = parent
    this.children = []
    let serializer = DOMSerializer.fromSchema(mark.type.schema) // FIXME
    this.dom = serializer.serializeMark(mark, serializeOptions)
    this.contentDOM = this.dom
  }
}

let serializedContentNode = null
const serializeOptions = {onContent(_, dom) { serializedContentNode = dom }}

class NodeView {
  constructor(parent, node, deco) {
    this.parent = parent
    this.contentDOM = null
    let serializer = DOMSerializer.fromSchema(node.type.schema) // FIXME
    serializedContentNode = null
    this.dom = serializer.serializeNode(node, serializeOptions)
    this.contentDOM = serializedContentNode
    this.dom.pmView = this
    if (node.isLeaf) {
      this.children = nothing
    } else {
      this.children = NodeView.buildChildren(this, node, deco)
      NodeView.flushChildren(this.contentDOM, this.children)
    }
  }

  static buildChildren(parent, node, deco) {
    let result = [], target = result, openMarks = [], curParent = parent
    iterDeco(node, deco, widgets => {
      for (let i = 0; i < widgets.length; i++)
        target.push(new WidgetView(curParent, widgets[i]))
    }, (child, outerDeco, innerDeco) => {
      let keep = 0
      for (; keep < Math.min(openMarks.length, child.marks.length); ++keep)
        if (!child.marks[keep].eq(openMarks[keep])) break
      while (keep < openMarks.length) {
        curParent = curParent.parent
        openMarks.pop()
        target = openMarks.length ? openMarks[openMarks.length - 1].children : result
      }
      while (openMarks.length < child.marks.length) {
        let add = new MarkView(curParent, child.marks[openMarks.length])
        openMarks.push(add)
        target.push(add)
        target = add.children
        curParent = add
      }
      let nodeParent = curParent, nodeTarget = target
      if (outerDeco.length) {
        nodeParent = new DecoView(curParent, outerDeco)
        nodeTarget = nodeParent.children
      }
      let nodeView = new NodeView(nodeParent, child, innerDeco)
      nodeTarget.push(nodeView)
    })
    return result
  }

  static renderViews(parentDOM, views, stopAt) {
    let dom = parentDOM.firstChild
    for (let i = 0; i < views.length; i++) {
      let view = views[i], childDOM = view.dom
      if (childDOM.parentNode == parentDOM) {
        while (childDOM != dom) dom = rm(dom)
        dom = dom.nextSibling
      } else {
        parentDOM.insertBefore(childDOM, dom)
      }
      if (!(stopAt && stopAt(view)) && view.contentDOM)
        NodeView.renderViews(view.contentDOM, view.children)
    }
    while (dom) dom = rm(dom)
  }

  update(node, prevNode, deco) {
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

// FIXME move into decoration.js?
function iterDeco(parent, deco, onWidgets, onNode) {
  let locals = deco.locals(parent), offset = 0
  // Simple, cheap variant for when there are no local decorations
  if (locals.length == 0) {
    for (let i = 0; i < parent.childCount; i++) {
      let child = parent.child(i), end = offset + child.nodeSize
      onNode(child, locals, deco.forChild(offset, child), offset, end)
      offset = end
    }
    return
  }

  let decoIndex = 0, active = [], widgets = [], restNode = null
  for (let parentIndex = 0;;) {
    while (decoIndex < locals.length && locals[decoIndex].to == offset)
      widgets.push(locals[decoIndex++])
    if (widgets.length) {
      onWidgets(widgets, offset)
      widgets.length = 0
    }

    let child
    if (restNode) {
      child = restNode
      restNode = null
    } else if (parentIndex < parent.childCount) {
      child = parent.child(parentIndex++)
    } else {
      break
    }

    for (let i = 0; i < active.length; i++) if (active[i].to <= offset) active.splice(i--, 1)

    let end = offset + child.nodeSize
    if (child.isText) {
      let cutAt = end
      if (decoIndex < locals.length && locals[decoIndex].from < cutAt) cutAt = locals[decoIndex].from
      for (let i = 0; i < active.length; i++) if (active[i].to < cutAt) cutAt = active[i].to
      if (cutAt < end) {
        restNode = child.cut(end - cutAt)
        child = child.cut(0, end - cutAt)
        end = cutAt
      }
    }

    while (decoIndex < locals.length && locals[decoIndex].from < end) active.push(locals[decoIndex++])
    onNode(child, active, deco.forChild(offset, child), offset, end)
    offset = end
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
