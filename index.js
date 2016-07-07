const {Map} = require("../util/map")
const {elt, ensureCSSAdded, contains} = require("../util/dom")

const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput, finishUpdateFromDOM} = require("./input")
const {SelectionReader, selectionToDOM} = require("./selection")
require("./css")

class EditorView {
  constructor(place, state, props) {
    ensureCSSAdded()

    this.props = props
    this.state = state
    this.selection = this.state.selection

    // :: DOMNode
    // The editable DOM node containing the document.
    this.content = elt("div", {class: "ProseMirror-content", "pm-container": true})
    if (!props.spellCheck) this.content.spellcheck = false
    if (props.label) this.content.setAttribute("aria-label", props.label)
    // :: DOMNode
    // The outer DOM element of the editor.
    this.wrapper = elt("div", {class: "ProseMirror"}, this.content)

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
    if (this.composing) return null
    let redrawn = false
    let docChange = !state.doc.eq(this.state.doc)

    if (docChange || this.dirtyNodes.size) {
      redraw(this, state)
      this.dirtyNodes.clear()
      redrawn = true
    }

    if ((redrawn || !state.selection.eq(this.state.selection)) || state.view.requestedFocus)
      selectionToDOM(this, state.selection, state.view.requestedFocus)

    // FIXME somehow schedule this relative to ui/update so that it
    // doesn't cause extra layout
    let scrollTo = state.view.requestedScroll
    if (scrollTo != null) {
      if (scrollTo === true) scrollTo = state.selection.head == null ? state.selection.from : state.selection.from
      scrollPosIntoView(this, scrollTo)
    }

    // Make sure we don't use an outdated range on drop event
    if (this.dragging && docChange) this.dragging.move = false

    this.state = state
    this.selection = state.selection

    if (newProps) this.props = newProps

    return state.update({view: state.view.clean()})
  }

  // :: (string) → string
  // Return a translated string, if a [translate function](#translate)
  // has been supplied, or the original string.
  translate(string) {
    let trans = this.props.translate
    return trans ? trans(string) : string
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (document.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
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

  pendingDOMChange() { return this.domTouched }
  forceDOMChange() { finishUpdateFromDOM(this) }

  posAtCoords(coords) { return posAtCoords(this, coords) }
  coordsAtPos(pos) { return coordsAtPos(this, pos) }
}
exports.EditorView = EditorView
