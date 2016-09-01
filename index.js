const {Map} = require("./map")
const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput, finishUpdateFromDOM, dispatchKeyDown, dispatchKeyPress} = require("./input")
const {SelectionReader, selectionToDOM} = require("./selection")

// ::- An editor view manages the DOM structure that represents an
// editor. Its state and behavior are determined by its
// [props](#view.EditorProps).
class EditorView {
  constructor(place, props) {
    // :: Object
    // The view's current [props](#view.EditorProps).
    this.props = props
    // :: EditorState
    // The view's current [state](#state.EditorState).
    this.state = props.state

    // :: dom.Node
    // The editable DOM node containing the document.
    this.content = document.createElement("div")
    this.content.setAttribute("pm-container", "true")
    this.content.classList.add("ProseMirror-content")

    this.wrapper = document.createElement("div")
    this.wrapper.appendChild(this.content)

    this._root = null

    this.updateDOMForProps()

    if (place && place.appendChild) place.appendChild(this.wrapper)
    else if (place) place(this.wrapper)

    draw(this, this.state.doc)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.lastSelectedNode = null
    this.selectionReader = new SelectionReader(this)
    initInput(this)
  }

  // :: (Object)
  // Update the view's props. Will immediately cause an update to
  // the view's DOM.
  update(props) {
    this.props = props
    this.updateState(props.state)
    this.updateDOMForProps()
  }

  // :: (EditorState)
  // Update the editor's `state` prop, without touching any of the
  // other props.
  updateState(state) {
    let prevState = this.state
    this.state = state

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
    let label = this.someProp("label", f => f(this.state)) || ""
    if (this.content.getAttribute("aria-label") != label) this.content.setAttribute("aria-label", label)
    let className = "ProseMirror"
    this.someProp("class", f => { let cls = f(this.state); if (cls) className += " " + cls })
    if (this.wrapper.className != className) this.wrapper.className = className
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (this.content.ownerDocument.activeElement != this.content) return false
    let sel = this.root.getSelection()
    return sel.rangeCount && this.content.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode : sel.anchorNode)
  }

  // :: (string, (*) → *) → *
  // Goes over the values of a prop, first those from plugins, and
  // finally those from the base props, and calls `f` every time a
  // non-undefined value is found. When `f` returns a truthy value,
  // that is immediately returned.
  someProp(propName, f) {
    let value, plugins = this.state.plugins
    if (plugins) for (let i = 0; i < plugins.length; i++) {
      let prop = plugins[i][propName]
      if (prop != null && (value = f ? f(prop) : prop)) return value
    }
    let prop = this.props && this.props[propName]
    if (prop && (value = f ? f(prop) : prop)) return value
  }

  // :: ()
  // Focus the editor.
  focus() {
    this.content.focus()
  }

  // :: union<dom.Document, dom.DocumentFragment>
  // Get the document root in which the editor exists. This will
  // usually be the top-level `document`, but might be a shadow DOM
  // root if the editor is inside a shadow DOM.
  get root() {
    let cached = this._root
    if (cached == null) for (let search = this.wrapper.parentNode; search; search = search.parentNode) {
      if (search.nodeType == 9 || (search.nodeType == 11 && search.host))
        return this._root = search
    }
    return cached || document
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

  // :: ({left: number, top: number}) → ?number
  // Given a pair of coordinates, return the document position that
  // corresponds to them. May return null if the given coordinates
  // aren't inside of the visible editor.
  posAtCoords(coords) { return posAtCoords(this, coords) }

  // :: (number) → {left: number, right: number, top: number, bottom: number}
  // Returns the screen rectangle at a given document position. `left`
  // and `right` will be the same number, as this returns a flat
  // cursor-ish rectangle.
  coordsAtPos(pos) { return coordsAtPos(this, pos) }

  dispatchKeyDown(event) {
    return dispatchKeyDown(this, event)
  }

  dispatchKeyPress(event) {
    return dispatchKeyPress(this, event)
  }
}
exports.EditorView = EditorView

// EditorProps:: interface
//
// The configuration object that can be passed to an editor view. It
// supports the following properties (only `state` and `onAction` are
// required).
//
// The various event-handling functions may all return `true` to
// indicate that they handled the given event. The view will then take
// care to call `preventDefault` on the event, except with
// `handleDOMEvent, where the handler itself is responsible for that.
//
// Except for `state` and `onAction`, these may also be present on
// plugins. How a prop is resolved depends on the prop. Handler
// functions are called one at a time, starting with the plugins (in
// order of appearance), and finally looking at the base props, until
// one of them returns true. For some props, the first plugin that
// yields a value gets precedence. For `class`, all the classes
// returned are combined.
//
//   state:: EditorState
//   The state of the editor.
//
//   onAction:: (action: Object)
//   The callback over which to send actions (state updates) produced
//   by the view. You'll usually want to make sure this ends up
//   calling the view's [`update`](#view.EditorView.update) method
//   with a new state that has the action
//   [applied](#state.EditorState.applyAction).
//
//   handleDOMEvent:: ?(view: EditorView, event: dom.Event) → bool
//   Called before the view handles a DOM event.
//
//   handleKeyDown:: ?(view: EditorView, event: dom.KeyboardEvent) → bool
//   Called when the editor receives a `keydown` event.
//
//   handleKeyPress:: ?(view: EditorView, event: dom.KeyboardEvent) → bool
//   A handler for `keypress` events.
//
//   handleTextInput:: ?(view: EditorView, from: number, to: number, text: string) → bool
//   Whenever the user directly input text, this handler is called,
//   before the input is applied.
//
//   handleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent) → bool
//   Called for each node around a click, from the inside out.
//
//   handleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is clicked, after `handleClickOn` handlers
//   have been called.
//
//   handleDoubleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent) → bool
//   Called for each node around a double click.
//
//   handleDoubleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is double-clicked, after `handleDoubleClickOn`.
//
//   handleTripleClickOn:: ?(view: EditorView, pos: number, node: Node, nodePos: number, event: dom.MouseEvent) → bool
//   Called for each node around a triple click.
//
//   handleTripleClick:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when the editor is triple-clicked, after `handleTripleClickOn`.
//
//   handleContextMenu:: ?(view: EditorView, pos: number, event: dom.MouseEvent) → bool
//   Called when a context menu event is fired in the editor.
//
//   onFocus:: ?(view: EditorView)
//   Called when the editor is focused.
//
//   onBlur:: ?(view: EditorView)
//   Called when the editor loses focus.
//
//   transformPasted:: ?(Slice) → Slice
//   Can be used to transform pasted content before it is applied to the document.
//
//   spellcheck:: ?bool
//   Controls whether the DOM spellcheck attribute is enabled on the
//   editable content. Defaults to false.
//
//   class:: ?(state: EditorState) → ?string
//   Controls the CSS class name of the editor DOM node. Any classes
//   returned from this will be added to the default `ProseMirror`
//   class.
//
//   label:: ?(state: EditorState) → ?string
//   Can be used to set an `aria-label` attribute on the editable
//   content node.
//
//   scrollThreshold:: ?number
//   Determines the distance (in pixels) between the cursor and the
//   end of the visible viewport at which point, when scrolling the
//   cursor into view, scrolling takes place. Defaults to 0.
//
//   scrollMargin:: ?number
//   Determines the extra space (in pixels) that is left above or
//   below the cursor when it is scrolled into view. Defaults to 5.
