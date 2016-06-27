const {Map} = require("../util/map")
const {elt, ensureCSSAdded, contains} = require("../util/dom")

const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput} = require("./input")
const {SelectionReader, selectionToDOM, verticalMotionLeavesTextblock} = require("./selection")
require("./css")

class ProseMirrorView {
  constructor(place, opts, doc, sel, channel, ranges) {
    ensureCSSAdded()
    this.channel = channel

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

    this.doc = doc
    this.selection = sel

    draw(this, doc, ranges)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.lastSelectedNode = null
    this.selectionReader = new SelectionReader(this)
    initInput(this)
  }

  update(doc, selection, ranges, setFocus, scrollIntoView) {
    if (this.composing) return null
    let redrawn = false

    if (doc != this.doc || this.dirtyNodes.size) {
      redraw(this, this.dirtyNodes, doc, this.doc, ranges)
      this.dirtyNodes.clear()
      redrawn = true
    }

    if ((redrawn || !selection.eq(this.selection)) || setFocus)
      selectionToDOM(this, selection, setFocus)

    // FIXME somehow schedule this relative to ui/update so that it
    // doesn't cause extra layout
    if (scrollIntoView != null) scrollPosIntoView(this, scrollIntoView)

    this.doc = doc
    this.selection = selection
    return {redrawn}
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (document.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
  }

  verticalMotionLeavesTextblock(dir) {
    return verticalMotionLeavesTextblock(this, dir)
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
}
exports.ProseMirrorView = ProseMirrorView
