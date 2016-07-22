const {Map} = require("../util/map")
const {elt, ensureCSSAdded, contains} = require("../util/dom")

const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput, finishUpdateFromDOM, dispatchKey} = require("./input")
const {SelectionReader, selectionToDOM} = require("./selection")

require("./css")

// EditorProps:: interface
//
// The configuration object that can be passed to an editor view. It
// supports the following properties (only `onAction` is required).
//
//   onAction:: (action: Object)
//
//   keymaps:: ?[Keymap]
//
//   applyTextInput:: ?(state: EditorState, from: number, to: number, text: string) → ?EditorState
//
//   handleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number) → bool
//
//   handleClick:: ?(view: EditorView, pos: number) → bool
//
//   handleDoubleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number) → bool
//
//   handleDoubleClick:: ?(view: EditorView, pos: number) → bool
//
//   handleTripleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number) → bool
//
//   handleTripleClick:: ?(view: EditorView, pos: number) → bool
//
//   handleContextMenu:: ?(view: EditorView, pos: number) → bool
//
//   onFocus:: ?(view)
//
//   onBlur:: ?(view)
//
//   transformPasted:: ?(Slice) → Slice
//
//   spellCheck:: ?bool
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

    // :: DOMNode
    // The editable DOM node containing the document.
    this.content = elt("div", {class: "ProseMirror-content", "pm-container": true})
    // :: DOMNode
    // The outer DOM element of the editor.
    this.wrapper = elt("div", {class: "ProseMirror"}, this.content)

    this.updateDOMForProps()

    if (place && place.appendChild) place.appendChild(this.wrapper)
    else if (place) place(this.wrapper)

    draw(this, state.doc)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.lastSelectedNode = null
    this.selectionReader = new SelectionReader(this)
    initInput(this)
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
  }

  updateDOMForProps() {
    let spellcheck = !!this.someProp("spellcheck")
    if (spellcheck != this.content.spellcheck) this.content.spellcheck = spellcheck
    let label = this.someProp("label")
    if (this.content.getAttribute("aria-label") != label) this.content.setAttribute("aria-label", label)
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (document.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
  }

  someProp(propName, f) {
    let value, plugins = this.props.config && this.props.config.plugins
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

  dispatchKey(keyName) {
    return dispatchKey(this, keyName)
  }
}
exports.EditorView = EditorView

exports.keymap = function(keymap) {
  return {
    onKey(view, keyName) {
      let bound = keymap.lookup(keyName)
      return bound ? bound(view.state, view.props.onAction) : false
    }
  }
}
