const {DOMSerializer} = require("prosemirror-model")

const browser = require("./browser")

class ElementView {
  constructor(parent, children, dom, contentDOM) {
    this.parent = parent
    this.children = children
    this.dom = dom
    if (dom) dom.pmView = this
    this.contentDOM = contentDOM
  }

  matchesWidget() { return false }
  matchesDeco() { return false }
  matchesMark() { return false }
  matchesNode() { return false }

  parseRule() { return null }

  get size() {
    let size = 0
    for (let i = 0; i < this.children.length; i++) size += this.children[i].size
    return size
  }

  get border() { return 0 }

  destroy() {
    if (this.dom) this.dom.pmView = null
    for (let i = 0; i < this.children.length; i++)
      this.children[i].destroy()
  }

  posBeforeChild(child) {
    for (let i = 0, pos = this.posAtStart; i < this.children.length; i++) {
      let cur = this.children[i]
      if (cur == child) return pos
      pos += cur.size
    }
  }

  get posAtStart() {
    return this.parent ? this.parent.posBeforeChild(this) + this.border : 0
  }

  get posAtEnd() {
    return this.posAtStart + this.size - 2 * this.border
  }

  localPosFromDOM(dom, offset, bias) {
    if (dom == this.contentDOM) {
      let domAfter = this.contentDOM.childNodes[offset]
      while (domAfter && !domAfter.pmView) domAfter = domAfter.nextSibling
      return domAfter ? this.posBeforeChild(domAfter.pmView) : this.posAtEnd
    } else if (this.contentDOM ? dom.compareDocumentPosition(this.contentDOM) & 2 : bias < 0) {
      return this.posAtStart
    } else {
      return this.posAtEnd
    }
  }

  nearestView(dom) {
    for (; dom; dom = dom.parentNode) if (dom.pmView && dom.pmView.descendantOf(this))
      return dom.pmView
  }

  descendantOf(parent) {
    for (let cur = this; cur; cur = cur.parent) if (cur == parent) return true
    return false
  }

  posFromDOM(dom, offset, bias) {
    for (;;) {
      let view = dom.pmView
      if (view && view.descendantOf(this))
        return view.localPosFromDOM(dom, offset, bias)
      offset = Array.prototype.indexOf.call(dom.parentNode.childNodes, dom)
      dom = dom.parentNode
    }
  }

  domFromPos(pos) {
    if (!this.contentDOM) return {node: this.dom, offset: 0}
    for (let offset = 0, i = 0;; i++) {
      if (offset == pos) return {node: this.contentDOM, offset: i}
      if (i == this.children.length) throw new Error("Invalid position " + pos)
      let child = this.children[i], end = offset + child.size
      if (pos < end) return child.domFromPos(pos - offset - child.border)
      offset = end
    }
  }

  domAfterPos(pos) {
    let {node, offset} = this.domFromPos(pos)
    if (node.nodeType != 1 || offset == node.childNodes.length)
      throw new RangeError("No node after pos " + pos)
    return node.childNodes[offset]
  }
}

const nothing = []

class WidgetView extends ElementView {
  constructor(parent, widget) {
    super(parent, nothing, widget.type.widget, null)
    this.widget = widget
  }

  // FIXME use constructors and better compare
  matchesWidget(widget) { return widget.type == this.widget.type }

  parseRule() { return {ignore: true} }

  get size() { return 0 }
}

class MarkView extends ElementView {
  constructor(parent, mark) {
    let serializer = DOMSerializer.fromSchema(mark.type.schema) // FIXME
    let dom = serializer.serializeMark(mark, serializeOptions)
    super(parent, [], dom, dom)
    this.mark = mark
  }

  parseRule() { return {mark: this.mark.type.name, attrs: this.mark.attrs, contentElement: this.contentDOM} }

  matchesMark(mark) { return this.mark.eq(mark) }
}

class DecoView extends ElementView {
  constructor(parent, deco, child) {
    let inner, outer
    for (let i = 0; i < deco.length; i++) {
      let attrs = deco[i].type.attrs
      let dom = document.createElement(attrs.nodeName || (inner.isInline ? "span" : "div"))
      for (let name in attrs) if (name != "nodeName") dom.setAttribute(name, attrs[name])
      if (outer) dom.appendChild(outer)
      else inner = dom
      outer = dom
    }

    super(parent, [child], outer, inner)
    child.parent = this
    this.deco = deco
  }

  parseRule() { return {skip: this.contentDOM} }

  matchesDeco(deco) {
    if (deco.length != this.deco.length) return false
    for (let i = 0; i < deco.length; i++)
      if (!deco[i].sameOutput(this.deco[i])) return false
    return true
  }
}

let serializedContentNode = null
const serializeOptions = {onContent(_, dom) { serializedContentNode = dom }}

class NodeView extends ElementView {
  constructor(parent, node, deco, dom, contentDOM) {
    super(parent, node.isLeaf ? nothing : [], dom, contentDOM)
    this.node = node
    this.deco = deco
    if (!node.isLeaf) this.updateChildren()
  }

  static create(parent, node, deco) {
    serializedContentNode = null
    let serializer = DOMSerializer.fromSchema(node.type.schema) // FIXME
    let dom = serializer.serializeNode(node, serializeOptions)
    return new NodeView(parent, node, deco, dom, serializedContentNode)
  }

  parseRule() { return {node: this.node.type.name, attrs: this.node.attrs, contentElement: this.contentDOM} }

  matchesNode(node, deco) {
    return node.eq(this.node) && deco.sameOutput(this.deco)
  }

  get size() { return this.node.nodeSize }

  get border() { return this.node.isLeaf ? 0 : 1 }

  localPosFromDOM(dom, offset, bias) {
    return this.node.isText ? this.posAtStart + offset : super.localPosFromDOM(dom, offset, bias)
  }

  domFromPos(pos) {
    return this.node.isText ? {node: this.dom, offset: pos} : super.domFromPos(pos)
  }

  updateChildren() {
    let updater = new ViewTreeUpdater(this)
    iterDeco(this.node, this.deco, widgets => {
      updater.placeWidgets(widgets)
    }, (child, outerDeco, innerDeco) => {
      updater.syncToMarks(child.marks)
      updater.findNodeMatch(child, outerDeco, innerDeco) ||
        updater.updateNode(child, outerDeco, innerDeco) ||
        updater.addNode(child, outerDeco, innerDeco)
    })
    updater.close()

    this.renderChildren()
  }

  renderChildren() {
    renderViews(this.contentDOM, this.children, NodeView.is)
    if (this.node.isTextblock) addTrailingHacks(this.contentDOM, this)
    if (browser.ios) iosHacks(this.dom)
  }

  update(node, deco) {
    if (!node.sameMarkup(this.node) ||
        (node.isText && node.text != this.node.text) ||
        !deco.sameOutput(this.deco)) return false
    this.node = node
    this.deco = deco
    if (!node.isLeaf) this.updateChildren()
    return true
  }

  markDirty(from, to) { markDirty(this, from, to) }
}
exports.NodeView = NodeView

function markDirty(view, from, to) {
  for (let offset = 0, i = 0; i < view.children.length; i++) {
    let child = view.children[i], end = offset + child.size
    if (from < end && to > offset) {
      if (from > offset && to < end) {
        let start = offset + child.border
        markDirty(child, from - start, to - start)
      } else {
        child.destroy()
        view.children.splice(i--, 1)
      }
    }
    offset = end
  }
}

function renderViews(parentDOM, views) {
  let dom = parentDOM.firstChild
  for (let i = 0; i < views.length; i++) {
    let view = views[i], childDOM = view.dom
    if (childDOM.parentNode == parentDOM) {
      while (childDOM != dom) dom = rm(dom)
      dom = dom.nextSibling
    } else {
      parentDOM.insertBefore(childDOM, dom)
    }
    if (!(view instanceof NodeView))
      renderViews(view.contentDOM, view.children)
  }
  while (dom) dom = rm(dom)
}
exports.renderViews = renderViews

function rm(dom) {
  let next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

class ViewTreeUpdater {
  constructor(top) {
    this.top = top
    this.index = 0
    this.stack = []
  }

  destroyBetween(start, end) {
    if (start == end) return
    for (let i = start; i < end; i++) this.top.children[i].destroy()
    this.top.children.splice(start, end - start)
  }

  destroyRest() {
    this.destroyBetween(this.index, this.top.children.length)
  }

  close() {
    for (;;) {
      this.destroyRest()
      if (this.stack.length == 0) break
      this.index = this.stack.pop()
      this.top = this.stack.pop()
    }
  }

  syncToMarks(marks) {
    let keep = 0, depth = this.stack.length >> 1
    let maxKeep = Math.min(depth, marks.length), next
    while (keep < maxKeep && this.stack[keep << 1].matchesMark(marks[keep])) keep++

    while (keep < depth) {
      this.destroyRest()
      this.index = this.stack.pop()
      this.top = this.stack.pop()
      depth--
    }
    while (depth < marks.length) {
      this.stack.push(this.top, this.index + 1)
      if (this.index < this.top.children.length &&
          (next = this.top.children[this.index]).matchesMark(marks[depth])) {
        this.top = next
      } else {
        let markView = new MarkView(this.top, marks[depth])
        this.top.children.splice(this.index, 0, markView)
        this.top = markView
      }
      this.index = 0
      depth++
    }
  }

  // FIXME think about failure cases where updates will redraw too much
  findNodeMatch(node, outerDeco, innerDeco) {
    for (let i = this.index, children = this.top.children, e = Math.min(children.length, i + 5); i < e; i++) {
      let next = children[i]
      if (outerDeco.length) {
        if (next.matchesDeco(outerDeco)) next = next.children[0]
        else continue
      }
      if (next.matchesNode(node, innerDeco)) {
        this.destroyBetween(this.index, i)
        this.index++
        return true
      }
    }
    return false
  }

  updateNode(node, outerDeco, innerDeco) {
    if (this.index == this.top.children.length) return false
    let next = this.top.children[this.index]
    if (outerDeco.length) {
      if (next.matchesDeco(outerDeco)) next = next.children[0]
      else return false
    }
    if (!(next instanceof NodeView && next.update(node, innerDeco))) return false
    this.index++
    return true
  }

  addNode(node, outerDeco, innerDeco) {
    let nodeView = NodeView.create(this.top, node, innerDeco)
    if (outerDeco.length) nodeView = new DecoView(top, outerDeco, nodeView)
    this.top.children.splice(this.index++, 0, nodeView)
  }

  placeWidgets(widgets) {
    let placed = 0
    while (placed < widgets.length && this.index < this.top.children.length &&
           this.top.children[this.index].matchesWidget(widgets[placed])) {
      this.index++
      placed++
    }
    for (let i = placed; i < widgets.length; i++)
      this.top.children.splice(this.index++, 0, new WidgetView(top, widgets[i]))
  }
}

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

class DummyView extends ElementView {
  constructor(parent, dom) {
    super(parent, nothing, dom, null)
  }
  parseRule() { return {ignore: true} }
}

function addTrailingHacks(dom, parent) {
  let lastChild = dom.lastChild
  if (!lastChild || lastChild.nodeName == "BR")
    dom.appendChild(new DummyView(parent, document.createElement("br")).dom)
  else if (lastChild.contentEditable == "false" || (lastChild.pmView instanceof WidgetView))
    dom.appendChild(new DummyView(parent, document.createElement("span")).dom)
}

function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    let oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}
