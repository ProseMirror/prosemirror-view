const {Map} = require("../util/map")
const {elt, ensureCSSAdded, contains} = require("../util/dom")

const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput, finishUpdateFromDOM, dispatchKeyDown, dispatchKeyPress} = require("./input")
const {SelectionReader, selectionToDOM} = require("./selection")

require("./css")

// EditorProps:: interface
//
// The configuration object that can be passed to an editor view. It
// supports the following properties (only `onAction` is required).
//
//   onAction:: (action: Object)
//
//   handleDOMEvent:: ?(view: EditorView, event: DOMEvent) → bool
//
//   handleKeyDown:: ?(view: EditorView, event: KeyboardEvent) → bool
//
//   handleKeyPress:: ?(view: EditorView, event: KeyboardEvent) → bool
//
//   handleTextInput:: ?(view: EditorView, from: number, to: number, text: string) → bool
//
//   handleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: MouseEvent) → bool
//
//   handleClick:: ?(view: EditorView, pos: number, event: MouseEvent) → bool
//
//   handleDoubleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: MouseEvent) → bool
//
//   handleDoubleClick:: ?(view: EditorView, pos: number, event: MouseEvent) → bool
//
//   handleTripleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: MouseEvent) → bool
//
//   handleTripleClick:: ?(view: EditorView, pos: number, event: MouseEvent) → bool
//
//   handleContextMenu:: ?(view: EditorView, pos: number, event: MouseEvent) → bool
//
//   onFocus:: ?(view: EditorView)
//
//   onBlur:: ?(view: EditorView)
//
//   onUpdate:: ?(view: EditorView, oldState: EditorState, newState: EditorState)
//
//   transformPasted:: ?(Slice) → Slice
//
//   spellcheck:: ?bool
//
//   label:: ?string
//
//   scrollThreshold:: ?number
//
//   scrollMargin:: ?number

class EditorView {
  constructor(place, state, props) {
    ensureCSSAdded()

    this.props = props
    this.state = state

    this.subViews = []

    // :: DOMNode
    // The editable DOM node containing the document.
    this.content = elt("div", {class: "ProseMirror-content", "pm-container": true})
    // :: DOMNode
    // The outer DOM element of the editor.
    this.wrapper = elt("div", null, this.content)

    this.updateDOMForProps()

    if (place && place.appendChild) place.appendChild(this.wrapper)
    else if (place) place(this.wrapper)

    draw(this, state.doc)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.lastSelectedNode = null
    this.selectionReader = new SelectionReader(this)
    initInput(this)

    this.updateSubViews(state, state)
  }

  update(state, newProps) {
    let prevState = this.state
    this.state = state
    if (newProps) {
      this.props = newProps
      this.updateDOMForProps()
    }

    if (this.inDOMChange) {
      if (state.view.inDOMChange != this.inDOMChange.id)
        setTimeout(() => finishUpdateFromDOM(this), 0)
      return
    } else if (state.view.inDOMChange != null) {
      setTimeout(() => this.props.onAction({type: "endDOMChange"}), 0)
      return
    }

    let redrawn = false
    let docChange = !state.doc.eq(prevState.doc)

    if (docChange || this.dirtyNodes.size) {
      redraw(this, prevState, state)
      this.dirtyNodes.clear()
      redrawn = true
    }

    if (redrawn || !state.selection.eq(prevState.selection))
      selectionToDOM(this, state.selection)

    // FIXME somehow schedule this relative to ui/update so that it
    // doesn't cause extra layout
    if (state.view.scrollToSelection)
      scrollPosIntoView(this, state.selection.head == null ? state.selection.from : state.selection.from)

    // Make sure we don't use an outdated range on drop event
    if (this.dragging && docChange) this.dragging.move = false

    this.updateSubViews(prevState, state)
  }

  updateSubViews(prevState, state) {
    let plugins = this.props.plugins || []
    let iView = 0, newViews = []
    for (let iPlugin = 0; iPlugin < plugins.length; iPlugin++) {
      let plugin = plugins[iPlugin]
      if (!plugin.createView) continue
      let found = this.subViews.indexOf(plugin, iView), view
      if (found > -1) {
        for (; iView < found; iView += 2)
          this.subViews[iView].destroyView(this.subViews[iView + 1])
        view = this.subViews[found + 1]
        iView = found + 2
        plugin.updateView(view, prevState, state, this.props)
      } else {
        view = plugin.createView(this, state, this.props)
      }
      newViews.push(plugin, view)
    }
    for (; iView < this.subViews.length; iView += 2)
      this.subViews[iView].destroyView(this.subViews[iView + 1])
    this.subViews = newViews
  }

  updateDOMForProps() {
    let spellcheck = !!this.someProp("spellcheck")
    if (spellcheck != this.content.spellcheck) this.content.spellcheck = spellcheck
    let label = this.someProp("label")
    if (this.content.getAttribute("aria-label") != label) this.content.setAttribute("aria-label", label)
    let className = "ProseMirror"
    this.someProp("className", str => className += " " + str)
    if (this.wrapper.className != className) this.wrapper.className = className
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (this.content.ownerDocument.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
  }

  someProp(propName, f) {
    let value, plugins = this.props.plugins
    if (plugins) for (let i = 0; i < plugins.length; i++) {
      let prop = plugins[i][propName]
      if (prop && (value = f ? f(prop) : prop)) return value
    }
    let prop = this.props && this.props[propName]
    if (prop && (value = f ? f(prop) : prop)) return value
  }

  focus() {
    this.content.focus()
  }

  markRangeDirty(from, to, doc) {
    let dirty = this.dirtyNodes
    let $from = doc.resolve(from), $to = doc.resolve(to)
    let same = $from.sameDepth($to)
    for (let depth = 0; depth <= same; depth++) {
      let child = $from.node(depth)
      if (!dirty.has(child)) dirty.set(child, DIRTY_RESCAN)
    }
    let start = $from.index(same), end = $to.indexAfter(same)
    let parent = $from.node(same)
    for (let i = start; i < end; i++)
      dirty.set(parent.child(i), DIRTY_REDRAW)
  }

  markAllDirty() {
    this.dirtyNodes.set(this.doc, DIRTY_REDRAW)
  }

  posAtCoords(coords) { return posAtCoords(this, coords) }
  coordsAtPos(pos) { return coordsAtPos(this, pos) }

  dispatchKeyDown(event) {
    return dispatchKeyDown(this, event)
  }

  dispatchKeyPress(event) {
    return dispatchKeyPress(this, event)
  }
}
exports.EditorView = EditorView
