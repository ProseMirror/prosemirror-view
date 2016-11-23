const {DOMSerializer} = require("prosemirror-model")

const browser = require("./browser")

function buildViewSpecs(schema) {
  let result = {}
  ;[schema.nodes, schema.marks].forEach(set => {
    for (let name in set) {
      let toDOM = set[name].spec.toDOM
      if (toDOM) result[name] = {toDOM: value => DOMSerializer.renderSpec(document, toDOM(value))}
    }
  })
  return result
}

class ElementView {
  constructor(parent, children, dom, contentDOM) {
    this.parent = parent
    this.children = children
    this.dom = dom
    if (dom) dom.pmView = this
    this.contentDOM = contentDOM
  }

  matchesWidget() { return false }
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
    this.dom.pmView = null
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
      while (domAfter && (!domAfter.pmView || domAfter.pmView.parent != this)) domAfter = domAfter.nextSibling
      return domAfter ? this.posBeforeChild(domAfter.pmView) : this.posAtEnd
    } else if (this.contentDOM ? dom.compareDocumentPosition(this.contentDOM) & 2 : !bias || bias < 0) {
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
    let textOffset = 0
    if (dom.nodeType == 3) { textOffset = offset; offset = 0 }
    for (;;) {
      let view = dom.pmView
      if (view && view.descendantOf(this))
        return view.localPosFromDOM(dom, offset, bias) +
          (textOffset && view.node && view.node.isText ? textOffset : 0)
      offset = Array.prototype.indexOf.call(dom.parentNode.childNodes, dom)
      dom = dom.parentNode
    }
  }

  domFromPos(pos, changedDOM) {
    if (!this.contentDOM) return {node: this.dom, offset: 0}
    for (let offset = 0, i = 0;; i++) {
      if (offset == pos)
        return {node: this.contentDOM,
                offset: changedDOM ? this.findDOMOffset(i) : i}
      if (i == this.children.length) throw new Error("Invalid position " + pos)
      let child = this.children[i], end = offset + child.size
      if (pos < end) return child.domFromPos(pos - offset - child.border, changedDOM)
      offset = end
    }
  }

  findDOMOffset(i) {
    let childNodes = this.contentDOM.childNodes
    if (i) {
      let found = Array.prototype.indexOf.call(childNodes, this.children[i - 1].dom)
      if (found > -1) return found + 1
    }
    if (i < this.children.length) {
      let found = Array.prototype.indexOf.call(childNodes, this.children[i].dom)
      if (found > -1) return found
    }
    return i ? childNodes.length : 0
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

  matchesWidget(widget) { return widget.type == this.widget.type }

  parseRule() { return {ignore: true} }

  get size() { return 0 }
}

class MarkView extends ElementView {
  constructor(parent, mark, dom) {
    super(parent, [], dom, dom)
    this.mark = mark
  }

  static create(parent, mark, specs) {
    let spec = specs[mark.type.name]
    let {dom} = spec.toDOM(mark)
    return new MarkView(parent, mark, dom)
  }

  parseRule() { return {mark: this.mark.type.name, attrs: this.mark.attrs, contentElement: this.contentDOM} }

  matchesMark(mark) { return this.mark.eq(mark) }
}

class NodeView extends ElementView {
  constructor(parent, node, outerDeco, innerDeco, dom, contentDOM, specs) {
    super(parent, node.isLeaf ? nothing : [], dom, contentDOM)
    this.node = node
    this.outerDeco = outerDeco
    this.innerDeco = innerDeco
    if (!node.isLeaf) this.updateChildren(specs)
  }

  static create(parent, node, outerDeco, innerDeco, specs) {
    let spec = specs[node.type.name]
    let {dom, contentDOM} = spec.toDOM(node)
    for (let i = 0; i < outerDeco.length; i++)
      dom = applyOuterDeco(dom, outerDeco[i].type.attrs, node)
    return new NodeView(parent, node, outerDeco, innerDeco, dom, contentDOM, specs)
  }

  parseRule() { return {node: this.node.type.name, attrs: this.node.attrs, contentElement: this.contentDOM} }

  matchesNode(node, outerDeco, innerDeco) {
    return node.eq(this.node) && sameOuterDeco(outerDeco, this.outerDeco) && innerDeco.eq(this.innerDeco)
  }

  get size() { return this.node.nodeSize }

  get border() { return this.node.isLeaf ? 0 : 1 }

  domFromPos(pos, changedDOM) {
    return this.node.isText ? {node: findText(this.dom), offset: pos} : super.domFromPos(pos, changedDOM)
  }

  updateChildren(specs) {
    let updater = new ViewTreeUpdater(this)
    iterDeco(this.node, this.innerDeco, widgets => {
      updater.placeWidgets(widgets)
    }, (child, outerDeco, innerDeco) => {
      updater.syncToMarks(child.marks, specs)
      updater.findNodeMatch(child, outerDeco, innerDeco) ||
        updater.updateNode(child, outerDeco, innerDeco, specs) ||
        updater.addNode(child, outerDeco, innerDeco, specs)
    })
    updater.close()

    this.renderChildren()
  }

  renderChildren() {
    renderViews(this.contentDOM, this.children, NodeView.is)
    if (this.node.isTextblock) addTrailingHacks(this.contentDOM)
    if (browser.ios) iosHacks(this.dom)
  }

  maybeUpdate(node, outerDeco, innerDeco, specs) {
    if (!node.sameMarkup(this.node) ||
        (node.isText && node.text != this.node.text) ||
        !sameOuterDeco(outerDeco, this.outerDeco)) return false
    this.update(node, outerDeco, innerDeco, specs)
    return true
  }

  update(node, outerDeco, innerDeco, specs) {
    this.node = node
    this.outerDeco = outerDeco
    this.innerDeco = innerDeco
    if (!node.isLeaf) this.updateChildren(specs)
  }

  markDirty(from, to) { markDirty(this, from, to) }

  static specsFromSchema(schema) {
    return schema.cached.nodeViewSpecs ||
      (schema.cached.nodeViewSpecs = buildViewSpecs(schema))
  }
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
    if (!(view instanceof NodeView) && view.contentDOM)
      renderViews(view.contentDOM, view.children)
  }
  while (dom) dom = rm(dom)
}

function applyOuterDeco(dom, attrs, node) {
  if (attrs.nodeName || dom.nodeType != 1) {
    let wrap = document.createElement(attrs.nodeName || (node.isInline ? "span" : "div"))
    wrap.appendChild(dom)
    dom = wrap
  }
  for (let name in attrs) {
    let val = attrs[name]
    if (name == "class") dom.classList.add(...val.split(" "))
    else if (name == "style") dom.style.cssText += ";" + val
    else if (name != "nodeName") dom.setAttribute(name, val)
  }
  return dom
}

function sameOuterDeco(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}

function rm(dom) {
  let next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

function findText(dom) {
  for (;;) {
    if (dom.nodeType == 3) return dom
    dom = dom.firstChild
  }
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

  syncToMarks(marks, specs) {
    let keep = 0, depth = this.stack.length >> 1
    let maxKeep = Math.min(depth, marks.length), next
    while (keep < maxKeep &&
           (keep == depth - 1 ? this.top : this.stack[(keep + 1) << 1]).matchesMark(marks[keep]))
      keep++

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
        let markView = MarkView.create(this.top, marks[depth], specs)
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
      if (children[i].matchesNode(node, outerDeco, innerDeco)) {
        this.destroyBetween(this.index, i)
        this.index++
        return true
      }
    }
    return false
  }

  updateNode(node, outerDeco, innerDeco, specs) {
    if (this.index == this.top.children.length) return false
    let next = this.top.children[this.index]
    if (!(next instanceof NodeView && next.maybeUpdate(node, outerDeco, innerDeco, specs))) return false
    this.index++
    return true
  }

  addNode(node, outerDeco, innerDeco, specs) {
    this.top.children.splice(this.index++, 0, NodeView.create(this.top, node, outerDeco, innerDeco, specs))
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
      onWidgets(widgets)
      widgets = []
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
    while (decoIndex < locals.length && locals[decoIndex].from == offset) active.push(locals[decoIndex++])

    let end = offset + child.nodeSize
    if (child.isText) {
      let cutAt = end
      if (decoIndex < locals.length && locals[decoIndex].from < cutAt) cutAt = locals[decoIndex].from
      for (let i = 0; i < active.length; i++) if (active[i].to < cutAt) cutAt = active[i].to
      if (cutAt < end) {
        restNode = child.cut(cutAt - offset)
        child = child.cut(0, cutAt - offset)
        end = cutAt
      }
    }

    onNode(child, active, deco.forChild(offset, child))
    offset = end
  }
}

class DummyView extends ElementView {
  constructor(dom) {
    super(null, nothing, dom, null)
  }
  parseRule() { return {ignore: true} }
}

function addTrailingHacks(dom) {
  let lastChild = dom.lastChild
  if (!lastChild || lastChild.nodeName == "BR")
    dom.appendChild(new DummyView(document.createElement("br")).dom)
  else if (lastChild.contentEditable == "false" || (lastChild.pmView instanceof WidgetView))
    dom.appendChild(new DummyView(document.createElement("span")).dom)
}

function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    let oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}
