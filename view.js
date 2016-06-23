const {Map} = require("../util/map")
const {requestAnimationFrame, cancelAnimationFrame, elt, ensureCSSAdded, contains} = require("../util/dom")
const {scrollIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {Input} = require("./input")

require("./css")

class ViewState {
  constructor(doc, selection) {
    this.doc = doc
    this.selection = selection
  }
}

class ProseMirrorView {
  constructor(place, opts, state, channel) {
    ensureCSSAdded()

    // :: DOMNode
    // The editable DOM node containing the document.
    this.content = elt("div", {class: "ProseMirror-content", "pm-container": true})
    if (!opts.spellCheck) this.content.spellcheck = false
    if (opts.label) this.content.setAttribute("aria-label", opts.label)
    // :: DOMNode
    // The outer DOM element of the editor.
    this.wrapper = elt("div", {class: "ProseMirror"}, this.content)
    this.wrapper.ProseMirror = this

    if (place && place.appendChild) place.appendChild(this.wrapper)
    else if (place) place(this.wrapper)

    this.state = state
    this.channel = channel

    draw(this, state.doc)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.sel = new SelectionState(this, Selection.findAtStart(this.doc))
    this.accurateSelection = false
    this.input = new Input(this)
  }

  hasFocus() {
    if (document.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
  }
}
