const {DOMSerializer} = require("prosemirror-model")

const browser = require("./browser")

// NodeView:: interface
//
// By default, document nodes are rendered using the result of the
// [`toDOM`](#view.NodeSpec.toDOM) method of its spec, and managed
// entirely by the editor. For some use cases, such as embedded
// node-specific editing interfaces, when you need more control over
// the behavior of a node's in-editor representation, and can
// [define](#view.EditorProps.nodeViews] a custom node view.
//
//   dom:: ?dom.Node
//   The outer DOM node that represents the document node. When not
//   given, the default strategy is used to create a DOM node.
//
//   contentDOM:: ?dom.Node
//   The DOM node that should hold the node's content. Only meaningful
//   if the node view also defines a `dom` property and if its node
//   type is not a leaf node type. When this is present, ProseMirror
//   will take care of rendering the node's children into it. When it
//   is not present, the node view itself is responsible for rendering
//   (or deciding not to render) its child nodes.
//
//   update:: ?(node: Node, deco: DecorationSet) → bool
//   When given, this will be called when the view is updating itself.
//   It will be given a node (possibly of a different type), and a
//   decoration set (which it may ignore, if it chooses not to support
//   decorations), and should return true if it was able to update to
//   that node, and false otherwise. If the node view has a
//   `contentDOM` property (or no `dom` property), updating its child
//   nodes will be handled by ProseMirror.
//
//   selectNode:: ?()
//   Can be used to override the way the node's selected status (as a
//   node selection) is displayed.
//
//   deselectNode:: ?()
//   When defining a `selectNode` method, you should also provide a
//   `deselectNode` method to disable it again.
//
//   setSelection:: ?(anchor: number, head: number, root: dom.Document)
//   This will be called to handle setting the selection inside the
//   node. By default, a DOM selection will be created between the DOM
//   positions corresponding to the given anchor and head positions,
//   but if you override it you can do something else.
//
//   destroy:: ?()
//   Called when the node view is removed from the editor or the whole
//   editor is detached.

// View descriptions are data structures that describe the DOM that is
// used to represent the editor's content. They are used for:
//
// - Incremental redrawing when the document changes
//
// - Figuring out what part of the document a given DOM position
//   corresponds to
//
// - Wiring in custom implementations of the editing interface for a
//   given node
//
// They form a doubly-linked mutable tree, starting at `view.docView`.

// Superclass for the various kinds of descriptions. Defines their
// basic structure and shared methods.
class ViewDesc {
  // : (?ViewDesc, [ViewDesc], dom.Node, ?dom.Node)
  constructor(parent, children, dom, contentDOM) {
    this.parent = parent
    this.children = children
    this.dom = dom
    // An expando property on the DOM node provides a link back to its
    // description.
    dom.pmViewDesc = this
    // This is the node that holds the child views. It may be null for
    // descs that don't have children.
    this.contentDOM = contentDOM
  }

  // Used to check whether a given description corresponds to a
  // widget/mark/node.
  matchesWidget() { return false }
  matchesMark() { return false }
  matchesNode() { return false }

  // : () → ?ParseRule
  // When parsing in-editor content (in domchange.js), we allow
  // descriptions to determine the parse rules that should be used to
  // parse them.
  parseRule() { return null }

  // The size of the content represented by this desc.
  get size() {
    let size = 0
    for (let i = 0; i < this.children.length; i++) size += this.children[i].size
    return size
  }

  // For block nodes, this represents the space taken up by their
  // start/end tokens.
  get border() { return 0 }

  destroy() {
    this.parent = this.dom.pmViewDesc = null
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

  // : (dom.Node, number, ?number) → number
  localPosFromDOM(dom, offset, bias) {
    // If the DOM position is in the content, use the child desc after
    // it to figure out a position.
    if (this.contentDOM && this.contentDOM.contains(dom.nodeType == 1 ? dom : dom.parentNode)) {
      let domAfter
      if (dom == this.contentDOM) {
        domAfter = dom.childNodes[offset]
      } else {
        while (dom.parentNode != this.contentDOM) dom = dom.parentNode
        domAfter = dom.nextSibling
      }
      while (domAfter && (!domAfter.pmViewDesc || domAfter.pmViewDesc.parent != this)) domAfter = domAfter.nextSibling
      return domAfter ? this.posBeforeChild(domAfter.pmViewDesc) : this.posAtEnd
    }
    // Otherwise, use various heuristics, falling back on the bias
    // parameter, to determine whether to return the position at the
    // start or at the end of this view desc.
    let atEnd
    if (this.contentDOM) {
      atEnd = dom.compareDocumentPosition(this.contentDOM) & 2
    } else if (this.dom.firstChild) {
      if (offset == 0) for (let search = dom;; search = search.parentNode) {
        if (search == this.dom) { atEnd = false; break }
        if (search.parentNode.firstChild != search) break
      }
      if (atEnd == null && offset == dom.childNodes.length) for (let search = dom;; search = search.parentNode) {
        if (search == this.dom) { atEnd = true; break }
        if (search.parentNode.lastChild != search) break
      }
    }
    return (atEnd == null ? bias > 0 : atEnd) ? this.posAtEnd : this.posAtStart
  }

  // Scan up the dom finding the first desc that is a descendant of
  // this one.
  nearestView(dom) {
    for (; dom; dom = dom.parentNode) {
      let desc = dom.pmViewDesc
      if (desc && desc.descendantOf(this)) return desc
    }
  }

  descendantOf(parent) {
    for (let cur = this; cur; cur = cur.parent) if (cur == parent) return true
    return false
  }

  posFromDOM(dom, offset, bias) {
    for (let scan = dom;; scan = scan.parentNode) {
      let desc = scan.pmViewDesc
      if (desc && desc.descendantOf(this)) return desc.localPosFromDOM(dom, offset, bias)
    }
  }

  // : (number) → ?NodeViewDesc
  // Find the desc for the node after the given pos, if any. (When a
  // parent node overrode rendering, there might not be one.)
  descAt(pos) {
    for (let i = 0, offset = 0; i < this.children.length; i++) {
      let child = this.children[i], end = offset + child.size
      if (offset == pos && end != offset) {
        while (!child.border && child.children.length) child = child.children[0]
        return child
      }
      if (pos < end) return child.descAt(pos - offset - child.border)
      offset = end
    }
  }

  // : (number, ?bool) → {node: dom.Node, offset: number}
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

  // If the DOM was directly edited, we can't trust the child view
  // desc offsets anymore, so we search the actual DOM to figure out
  // the offset that corresponds to a given child.
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

  // : (number) → dom.Node
  domAfterPos(pos) {
    let {node, offset} = this.domFromPos(pos)
    if (node.nodeType != 1 || offset == node.childNodes.length)
      throw new RangeError("No node after pos " + pos)
    return node.childNodes[offset]
  }

  // : (number, number, dom.Document)
  // View descs are responsible for setting any selection that falls
  // entirely inside of them, so that custom implementations can do
  // custom things with the selection. Note that this falls apart when
  // a selection starts in such a node and ends in another, in which
  // case we just use whatever domFromPos produces as a best effort.
  setSelection(anchor, head, root) {
    // If the selection falls entirely in a child, give it to that child
    let from = Math.min(anchor, head), to = Math.max(anchor, head)
    for (let i = 0, offset = 0; i < this.children.length; i++) {
      let child = this.children[i], end = offset + child.size
      if (from > offset && to < end)
        return child.setSelection(from - offset - child.border, to - offset - child.border, root)
      offset = end
    }

    let anchorDOM = this.domFromPos(anchor), headDOM = this.domFromPos(head)
    let domSel = root.getSelection(), range = document.createRange()

    // Selection.extend can be used to create an 'inverted' selection
    // (one where the focus is before the anchor), but not all
    // browsers support it yet.
    if (domSel.extend) {
      range.setEnd(anchorDOM.node, anchorDOM.offset)
      range.collapse(false)
    } else {
      if (anchor > head) { let tmp = anchorDOM; anchorDOM = headDOM; headDOM = tmp }
      range.setEnd(headDOM.node, headDOM.offset)
      range.setStart(anchorDOM.node, anchorDOM.offset)
    }
    domSel.removeAllRanges()
    domSel.addRange(range)
    if (domSel.extend)
      domSel.extend(headDOM.node, headDOM.offset)
  }

  // Remove a subtree of the element tree that has been touched
  // by a DOM change, so that the next update will redraw it.
  markDirty(from, to) {
    for (let offset = 0, i = 0; i < this.children.length; i++) {
      let child = this.children[i], end = offset + child.size
      if (from < end && to > offset) {
        if (from > offset && to < end) {
          let start = offset + child.border
          child.markDirty(from - start, to - start)
        } else {
          child.destroy()
          this.children.splice(i--, 1)
        }
      }
      offset = end
    }
  }
}

// Reused array to avoid allocating fresh arrays for things that will
// stay empty anyway.
const nothing = []

// A widget desc represents a widget decoration, which is a DOM node
// drawn between the document nodes.
class WidgetViewDesc extends ViewDesc {
  // : (ViewDesc, Decoration)
  constructor(parent, widget) {
    super(parent, nothing, widget.type.widget, null)
    this.widget = widget
  }

  matchesWidget(widget) { return widget.type == this.widget.type }

  parseRule() { return {ignore: true} }
}

// A mark desc represents a mark. May have multiple children,
// depending on how the mark is split. Note that marks are drawn using
// a fixed nesting order, for simplicity and predictability, so in
// some cases they will be split more often than would appear
// necessary.
class MarkViewDesc extends ViewDesc {
  // : (ViewDesc, Mark, dom.Node)
  constructor(parent, mark, dom) {
    super(parent, [], dom, dom)
    this.mark = mark
  }

  static create(parent, mark, view) {
    let custom = customNodeViews(view)[mark.type.name]
    let spec = custom && custom(mark, view)
    let dom = spec && spec.dom || DOMSerializer.renderSpec(document, mark.type.spec.toDOM(mark)).dom
    return new MarkViewDesc(parent, mark, dom)
  }

  parseRule() { return {mark: this.mark.type.name, attrs: this.mark.attrs, contentElement: this.contentDOM} }

  matchesMark(mark) { return this.mark.eq(mark) }
}

// Node view descs are the main, most common type of view desc, and
// correspond to an actual node in the document. Unlike mark descs,
// they populate their child array themselves.
class NodeViewDesc extends ViewDesc {
  // : (?ViewDesc, Node, [Decoration], DecorationSet, dom.Node, ?dom.Node, EditorView)
  constructor(parent, node, outerDeco, innerDeco, dom, contentDOM, view) {
    super(parent, node.isLeaf ? nothing : [], dom, contentDOM)
    this.node = node
    this.outerDeco = outerDeco
    this.innerDeco = innerDeco
    if (contentDOM) this.updateChildren(view)
  }

  // By default, a node is rendered using the `toDOM` method from the
  // node type spec. But client code can use the `nodeViews` spec to
  // supply a custom node view, which can influence various aspects of
  // the way the node works.
  //
  // (Using subclassing for this was intentionally decided against,
  // since it'd require exposing a whole slew of finnicky
  // implementation details to the user code that they probably will
  // never need.)
  static create(parent, node, outerDeco, innerDeco, view) {
    let custom = customNodeViews(view)[node.type.name], descObj
    let spec = custom && custom(node, view, () => {
      // (This is a function that allows the custom view to find its
      // own position)
      if (!descObj) return parent.posAtStart + parent.size
      if (descObj.parent) return descObj.parent.posBeforeChild(descObj)
    })

    let dom = spec && spec.dom, contentDOM
    if (!dom) ({dom, contentDOM} = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node)))
    let startDOM = dom
    for (let i = 0; i < outerDeco.length; i++)
      dom = applyOuterDeco(dom, outerDeco[i].type.attrs, node)

    if (spec)
      return descObj = new CustomNodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, spec, view)
    else if (node.isText)
      return new TextViewDesc(parent, node, outerDeco, innerDeco, dom, startDOM, view)
    else
      return new NodeViewDesc(parent, node, outerDeco, innerDeco, dom, contentDOM, view)
  }

  parseRule() { return {node: this.node.type.name, attrs: this.node.attrs, contentElement: this.contentDOM} }

  matchesNode(node, outerDeco, innerDeco) {
    return node.eq(this.node) && sameOuterDeco(outerDeco, this.outerDeco) && innerDeco.eq(this.innerDeco)
  }

  get size() { return this.node.nodeSize }

  get border() { return this.node.isLeaf ? 0 : 1 }

  // Syncs `this.children` to match `this.node.content` and the local
  // decorations, possibly introducing nesting for marks. Then, in a
  // separate step, syncs the DOM inside `this.contentDOM` to
  // `this.children`.
  updateChildren(view) {
    let updater = new ViewTreeUpdater(this)
    iterDeco(this.node, this.innerDeco, widget => {
      // If the next node is a desc matching this widget, reuse it,
      // otherwise insert the widget as a new view desc.
      updater.placeWidget(widget)
    }, (child, outerDeco, innerDeco) => {
      // Make sure the wrapping mark descs match the node's marks.
      updater.syncToMarks(child.marks, view)
      // Either find an existing desc that exactly matches this node,
      // and drop the descs before it.
      updater.findNodeMatch(child, outerDeco, innerDeco) ||
        // Or try updating the next desc to reflect this node.
        updater.updateNode(child, outerDeco, innerDeco, view) ||
        // Or just add it as a new desc.
        updater.addNode(child, outerDeco, innerDeco, view)
    })
    // Drop all remaining descs after the current position.
    updater.close()

    // Sync the DOM.
    this.renderChildren()
  }

  renderChildren() {
    renderDescs(this.contentDOM, this.children, NodeViewDesc.is)
    if (this.node.isTextblock) textblockHacks(this.contentDOM)
    if (browser.ios) iosHacks(this.dom)
  }

  // : (Node, [Decoration], DecorationSet, EditorView) → bool
  // If this desc be updated to match the given node decoration,
  // do so and return true.
  update(node, outerDeco, innerDeco, view) {
    if (!node.sameMarkup(this.node) ||
        !sameOuterDeco(outerDeco, this.outerDeco)) return false
    this.node = node
    this.innerDeco = innerDeco
    if (!node.isLeaf) this.updateChildren(view)
    return true
  }

  // Mark this node as being the selected node.
  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode")
  }

  // Remove selected node marking from this node.
  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode")
  }
}

// Create a view desc for the top-level document node, to be exported
// and used by the view class.
function docViewDesc(doc, deco, dom, view) {
  return new NodeViewDesc(null, doc, nothing, deco, dom, dom, view)
}
exports.docViewDesc = docViewDesc

class TextViewDesc extends NodeViewDesc {
  constructor(parent, node, outerDeco, innerDeco, dom, textDOM, view) {
    super(parent, node, outerDeco, innerDeco, dom, null, view)
    this.textDOM = textDOM
  }

  update(node, outerDeco) {
    if (!node.sameMarkup(this.node) ||
        !sameOuterDeco(outerDeco, this.outerDeco)) return false
    if (node.text != this.node.text) this.textDOM.nodeValue = node.text
    this.node = node
    return true
  }

  domFromPos(pos) {
    return {node: this.textDOM, offset: pos}
  }

  localPosFromDOM(dom, offset, bias) {
    if (dom == this.textDOM) return this.posAtStart + Math.min(offset, this.node.text.length)
    return super.localPosFromDOM(dom, offset, bias)
  }
}

// A separate subclass is used for customized node views, so that the
// extra checks only have to be made for nodes that are actually
// customized.
class CustomNodeViewDesc extends NodeViewDesc {
  // : (?ViewDesc, Node, [Decoration], DecorationSet, dom.Node, ?dom.Node, NodeView, EditorView)
  constructor(parent, node, outerDeco, innerDeco, dom, contentDOM, spec, view) {
    super(parent, node, outerDeco, innerDeco, dom, contentDOM, view)
    this.spec = spec
  }

  // A custom `update` method gets to decide whether the update goes
  // through. If it does, and there's a `contentDOM` node, our logic
  // updates the children.
  update(node, outerDeco, innerDeco, view) {
    if (this.spec.update) {
      let result = this.spec.update(node, innerDeco)
      if (result) {
        this.node = node
        if (this.contentDOM) this.updateChildren(view)
      }
      return result
    } else {
      return super.update(node, outerDeco, innerDeco, view)
    }
  }

  selectNode() {
    this.spec.selectNode ? this.spec.selectNode() : super.selectNode()
  }

  deselectNode() {
    this.spec.deselectNode ? this.spec.deselectNode() : super.deselectNode()
  }

  setSelection(anchor, head, root) {
    this.spec.setSelection ? this.spec.setSelection(anchor, head, root) : super.setSelection(anchor, head, root)
  }

  destroy() {
    if (this.spec.destroy) this.spec.destroy()
    super.destroy()
  }
}

// : (dom.Node, [ViewDesc])
// Sync the content of the given DOM node with the nodes associated
// with the given array of view descs, recursing into mark descs
// because this should sync the subtree for a whole node at a time.
function renderDescs(parentDOM, descs) {
  let dom = parentDOM.firstChild
  for (let i = 0; i < descs.length; i++) {
    let desc = descs[i], childDOM = desc.dom
    if (childDOM.parentNode == parentDOM) {
      while (childDOM != dom) dom = rm(dom)
      dom = dom.nextSibling
    } else {
      parentDOM.insertBefore(childDOM, dom)
    }
    if (desc instanceof MarkViewDesc)
      renderDescs(desc.contentDOM, desc.children)
  }
  while (dom) dom = rm(dom)
}

// : (dom.Node, Object, Node) → dom.Node
// Apply the extra attributes and potentially add a wrapper for a
// decoration.
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

// : ([Decoration], [Decoration]) → bool
function sameOuterDeco(a, b) {
  if (a.length != b.length) return false
  for (let i = 0; i < a.length; i++) if (!a[i].eq(b[i])) return false
  return true
}

// Remove a DOM node and return its next sibling.
function rm(dom) {
  let next = dom.nextSibling
  dom.parentNode.removeChild(dom)
  return next
}

// Helper class for incrementally updating a tree of mark descs and
// the widget and node descs inside of them.
class ViewTreeUpdater {
  // : (NodeViewDesc)
  constructor(top) {
    this.top = top
    // Index into `this.top`'s child array, represents the current
    // update position.
    this.index = 0
    // When entering a mark, the current top and index are pushed
    // onto this.
    this.stack = []
  }

  // Destroy and remove the children between the given indices in
  // `this.top`.
  destroyBetween(start, end) {
    if (start == end) return
    for (let i = start; i < end; i++) this.top.children[i].destroy()
    this.top.children.splice(start, end - start)
  }

  // Destroy all remaining children in `this.top`.
  destroyRest() {
    this.destroyBetween(this.index, this.top.children.length)
  }

  // Unwind the stack, destroying all remaining children at each
  // level.
  close() {
    for (;;) {
      this.destroyRest()
      if (this.stack.length == 0) break
      this.index = this.stack.pop()
      this.top = this.stack.pop()
    }
  }

  // : ([Mark], EditorView)
  // Sync the current stack of mark descs with the given array of
  // marks, reusing existing mark descs when possible.
  syncToMarks(marks, view) {
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
        let markDesc = MarkViewDesc.create(this.top, marks[depth], view)
        this.top.children.splice(this.index, 0, markDesc)
        this.top = markDesc
      }
      this.index = 0
      depth++
    }
  }

  // : (Node, [Decoration], DecorationSet) → bool
  // Try to find a node desc matching the given data. Skip over it and
  // return true when successful.
  findNodeMatch(node, outerDeco, innerDeco) {
    // FIXME think about failure cases where updates will redraw too much
    for (let i = this.index, children = this.top.children, e = Math.min(children.length, i + 5); i < e; i++) {
      if (children[i].matchesNode(node, outerDeco, innerDeco)) {
        this.destroyBetween(this.index, i)
        this.index++
        return true
      }
    }
    return false
  }

  // : (Node, [Decoration], DecorationSet, EditorView) → bool
  // Try to update the next node, if any, to the given data.
  updateNode(node, outerDeco, innerDeco, view) {
    if (this.index == this.top.children.length) return false
    let next = this.top.children[this.index]
    if (!(next instanceof NodeViewDesc && next.update(node, outerDeco, innerDeco, view))) return false
    this.index++
    return true
  }

  // : (Node, [Decoration], DecorationSet, EditorView)
  // Insert the node as a newly created node desc.
  addNode(node, outerDeco, innerDeco, view) {
    this.top.children.splice(this.index++, 0, NodeViewDesc.create(this.top, node, outerDeco, innerDeco, view))
  }

  placeWidget(widget) {
    if (this.index < this.top.children.length && this.top.children[this.index].matchesWidget(widget))
      this.index++
    else
      this.top.children.splice(this.index++, 0, new WidgetViewDesc(this.top, widget))
  }
}

// : (ViewDesc, DecorationSet, (Decoration), (Node, [Decoration], DecorationSet))
// This function abstracts iterating over the nodes and decorations in
// a fragment. Calls `onNode` for each node, with its local and child
// decorations. Splits text nodes when there is a decoration starting
// or ending inside of them. Calls `onWidget` for each widget.
function iterDeco(parent, deco, onWidget, onNode) {
  let locals = deco.locals(parent), offset = 0
  // Simple, cheap variant for when there are no local decorations
  if (locals.length == 0) {
    for (let i = 0; i < parent.childCount; i++) {
      let child = parent.child(i)
      onNode(child, locals, deco.forChild(offset, child))
      offset += child.nodeSize
    }
    return
  }

  let decoIndex = 0, active = [], restNode = null
  for (let parentIndex = 0;;) {
    while (decoIndex < locals.length && locals[decoIndex].to == offset)
      onWidget(locals[decoIndex++])

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

// Pre-calculate and cache the set of custom view specs for a given
// prop object.
let cachedCustomViews, cachedCustomFor
function customNodeViews(view) {
  if (cachedCustomFor == view.props) return cachedCustomViews
  cachedCustomFor = view.props
  return cachedCustomViews = buildCustomViews(view)
}
function buildCustomViews(view) {
  let result = {}
  view.someProp("nodeViews", obj => {
    for (let prop in obj) if (!Object.prototype.hasOwnProperty.call(result, prop))
      result[prop] = obj[prop]
  })
  return result
}

// A dummy desc used to tag trailing BR or span nodes created to work
// around contentEditable terribleness.
class DummyViewDesc extends ViewDesc {
  constructor(dom) {
    super(null, nothing, dom, null)
  }
  parseRule() { return {ignore: true} }
}

// Make sure a textblock looks and behaves correctly in
// contentEditable.
function textblockHacks(dom) {
  let lastChild = dom.lastChild
  if (!lastChild || lastChild.nodeName == "BR")
    dom.appendChild(new DummyViewDesc(document.createElement("br")).dom)
  else if (lastChild.contentEditable == "false" || (lastChild.pmViewDesc instanceof WidgetViewDesc))
    dom.appendChild(new DummyViewDesc(document.createElement("span")).dom)
}

// List markers in Mobile Safari will mysteriously disappear
// sometimes. This works around that.
function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    let oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}
