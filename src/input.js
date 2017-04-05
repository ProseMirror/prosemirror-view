const {Selection, NodeSelection, TextSelection} = require("prosemirror-state")

const browser = require("./browser")
const {captureKeyDown} = require("./capturekeys")
const {DOMChange} = require("./domchange")
const {parseFromClipboard, serializeForClipboard} = require("./clipboard")
const {DOMObserver} = require("./domobserver")
const {selectionBetween} = require("./selection")

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers = {}, editHandlers = {}

function initInput(view) {
  view.shiftKey = false
  view.mouseDown = null
  view.dragging = null
  view.inDOMChange = null
  view.domObserver = new DOMObserver(view)
  view.domObserver.start()

  for (let event in handlers) {
    let handler = handlers[event]
    view.dom.addEventListener(event, event => {
      if (eventBelongsToView(view, event) && !runCustomHandler(view, event) &&
          (view.editable || !(event.type in editHandlers)))
        handler(view, event)
    })
  }
  view.extraHandlers = Object.create(null)
  ensureListeners(view)
}
exports.initInput = initInput

function destroyInput(view) {
  view.domObserver.stop()
  if (view.inDOMChange) view.inDOMChange.destroy()
}
exports.destroyInput = destroyInput

function ensureListeners(view) {
  view.someProp("handleDOMEvents", currentHandlers => {
    for (let type in currentHandlers) if (!view.extraHandlers[type] && !handlers.hasOwnProperty(type)) {
      view.extraHandlers[type] = true
      view.dom.addEventListener(type, event => runCustomHandler(view, event))
    }
  })
}
exports.ensureListeners = ensureListeners

function runCustomHandler(view, event) {
  return view.someProp("handleDOMEvents", handlers => {
    let handler = handlers[event.type]
    return handler ? handler(view, event) || event.defaultPrevented : false
  })
}

function eventBelongsToView(view, event) {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node = event.target; node != view.dom; node = node.parentNode)
    if (!node || node.nodeType == 11 ||
        (node.pmViewDesc && node.pmViewDesc.stopEvent(event)))
      return false
  return true
}

function dispatchEvent(view, event) {
  if (!runCustomHandler(view, event) && handlers[event.type] &&
      (view.editable || !(event.type in editHandlers)))
    handlers[event.type](view, event)
}
exports.dispatchEvent = dispatchEvent

editHandlers.keydown = (view, event) => {
  if (event.keyCode == 16) view.shiftKey = true
  if (view.inDOMChange) return
  if (view.someProp("handleKeyDown", f => f(view, event)) || captureKeyDown(view, event))
    event.preventDefault()
  else
    view.selectionReader.poll()
}

editHandlers.keyup = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = false
}

editHandlers.keypress = (view, event) => {
  if (view.inDOMChange || !event.charCode ||
      event.ctrlKey && !event.altKey || browser.mac && event.metaKey) return

  if (view.someProp("handleKeyPress", f => f(view, event))) {
    event.preventDefault()
    return
  }

  let sel = view.state.selection
  if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to)) {
    let text = String.fromCharCode(event.charCode)
    if (!view.someProp("handleTextInput", f => f(view, sel.$from.pos, sel.$to.pos, text)))
      view.dispatch(view.state.tr.insertText(text).scrollIntoView())
    event.preventDefault()
  }
}

function eventCoords(event) { return {left: event.clientX, top: event.clientY} }

let lastClick = {time: 0, x: 0, y: 0}, oneButLastClick = lastClick

function isNear(event, click) {
  let dx = click.x - event.clientX, dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(view, propName, pos, inside, event) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    if (view.someProp(propName, f => i > $pos.depth ? f(view, pos, $pos.nodeAfter, $pos.before(i), event, true)
                                                    : f(view, pos, $pos.node(i), $pos.before(i), event, false)))
      return true
  }
  return false
}

function updateSelection(view, selection, origin) {
  if (!view.focused) view.focus()
  let tr = view.state.tr.setSelection(selection)
  if (origin == "pointer") tr.setMeta("pointer", true)
  view.dispatch(tr)
}

function selectClickedLeaf(view, inside) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside), node = $pos.nodeAfter
  if (node && node.isAtom && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos), "pointer")
    return true
  }
  return false
}

function selectClickedNode(view, inside) {
  if (inside == -1) return false
  let sel = view.state.selection, selectedNode, selectAt
  if (sel instanceof NodeSelection) selectedNode = sel.node

  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (NodeSelection.isSelectable(node)) {
      if (selectedNode && sel.$from.depth > 0 &&
          i >= sel.$from.depth && $pos.before(sel.$from.depth + 1) == sel.$from.pos)
        selectAt = $pos.before(sel.$from.depth)
      else
        selectAt = $pos.before(i)
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, NodeSelection.create(view.state.doc, selectAt), "pointer")
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, event, selectNode) {
  return runHandlerOnContext(view, "handleClickOn", pos, inside, event) ||
    view.someProp("handleClick", f => f(view, pos, event)) ||
    (selectNode ? selectClickedNode(view, inside) : selectClickedLeaf(view, inside))
}

function handleDoubleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleDoubleClickOn", pos, inside, event) ||
    view.someProp("handleDoubleClick", f => f(view, pos, event))
}

function handleTripleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleTripleClickOn", pos, inside, event) ||
    view.someProp("handleTripleClick", f => f(view, pos, event)) ||
    defaultTripleClick(view, inside)
}

function defaultTripleClick(view, inside) {
  let doc = view.state.doc
  if (inside == -1) {
    if (doc.inlineContent) {
      updateSelection(view, TextSelection.create(doc, 0, doc.content.size), "pointer")
      return true
    }
    return false
  }

  let $pos = doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.inlineContent)
      updateSelection(view, TextSelection.create(doc, nodePos + 1, nodePos + 1 + node.content.size), "pointer")
    else if (NodeSelection.isSelectable(node))
      updateSelection(view, NodeSelection.create(doc, nodePos), "pointer")
    else
      continue
    return true
  }
}

function forceDOMFlush(view) {
  if (!view.inDOMChange) return false
  view.inDOMChange.finish(true)
  return true
}

const selectNodeModifier = browser.mac ? "metaKey" : "ctrlKey"

handlers.mousedown = (view, event) => {
  let flushed = forceDOMFlush(view)
  let now = Date.now(), type
  if (now - lastClick.time >= 500 || !isNear(event, lastClick) || event[selectNodeModifier]) type = "singleClick"
  else if (now - oneButLastClick.time >= 600 || !isNear(event, oneButLastClick)) type = "doubleClick"
  else type = "tripleClick"
  oneButLastClick = lastClick
  lastClick = {time: now, x: event.clientX, y: event.clientY}

  let pos = view.posAtCoords(eventCoords(event))
  if (!pos) return

  if (type == "singleClick")
    view.mouseDown = new MouseDown(view, pos, event, flushed)
  else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event))
    event.preventDefault()
  else
    view.selectionReader.poll("pointer")
}

class MouseDown {
  constructor(view, pos, event, flushed) {
    this.view = view
    this.pos = pos
    this.event = event
    this.flushed = flushed
    this.selectNode = event[selectNodeModifier]
    this.allowDefault = event.shiftKey

    let targetNode, targetPos
    if (pos.inside > -1) {
      targetNode = view.state.doc.nodeAt(pos.inside)
      targetPos = pos.inside
    } else {
      let $pos = view.state.doc.resolve(pos.pos)
      targetNode = $pos.parent
      targetPos = $pos.depth ? $pos.before() : 0
    }

    this.mightDrag = null
    if (targetNode.type.spec.draggable && targetNode.type.spec.selectable !== false ||
        view.state.selection instanceof NodeSelection && targetPos == view.state.selection.from)
      this.mightDrag = {node: targetNode, pos: targetPos}

    this.target = flushed ? null : event.target
    if (this.target && this.mightDrag) {
      this.view.domObserver.stop()
      this.target.draggable = true
      if (browser.gecko && (this.setContentEditable = !this.target.hasAttribute("contentEditable")))
        setTimeout(() => this.target.setAttribute("contentEditable", "false"), 20)
      this.view.domObserver.start()
    }

    view.root.addEventListener("mouseup", this.up = this.up.bind(this))
    view.root.addEventListener("mousemove", this.move = this.move.bind(this))
    view.selectionReader.poll("pointer")
  }

  done() {
    this.view.root.removeEventListener("mouseup", this.up)
    this.view.root.removeEventListener("mousemove", this.move)
    if (this.mightDrag && this.target) {
      this.view.domObserver.stop()
      this.target.draggable = false
      if (browser.gecko && this.setContentEditable)
        this.target.removeAttribute("contentEditable")
      this.view.domObserver.start()
    }
  }

  up(event) {
    this.done()

    if (!this.view.dom.contains(event.target.nodeType == 3 ? event.target.parentNode : event.target))
      return

    if (this.allowDefault) {
      this.view.selectionReader.poll("pointer")
    } else if (handleSingleClick(this.view, this.pos.pos, this.pos.inside, event, this.selectNode)) {
      event.preventDefault()
    } else if (this.flushed) {
      updateSelection(this.view, Selection.near(this.view.state.doc.resolve(this.pos.pos)), "pointer")
      event.preventDefault()
    } else {
      this.view.selectionReader.poll("pointer")
    }
  }

  move(event) {
    if (!this.allowDefault && (Math.abs(this.event.x - event.clientX) > 4 ||
                               Math.abs(this.event.y - event.clientY) > 4))
      this.allowDefault = true
    this.view.selectionReader.poll("pointer")
  }
}

handlers.touchdown = view => {
  forceDOMFlush(view)
  view.selectionReader.poll("pointer")
}

handlers.contextmenu = (view, e) => {
  forceDOMFlush(view)
  let pos = view.posAtCoords(eventCoords(e))
  if (pos && view.someProp("handleContextMenu", f => f(view, pos.pos, e)))
    e.preventDefault()
}

// Input compositions are hard. Mostly because the events fired by
// browsers are A) very unpredictable and inconsistent, and B) not
// cancelable.
//
// ProseMirror has the problem that it must not update the DOM during
// a composition, or the browser will cancel it. What it does is keep
// long-running operations (delayed DOM updates) when a composition is
// active.
//
// We _do not_ trust the information in the composition events which,
// apart from being very uninformative to begin with, is often just
// plain wrong. Instead, when a composition ends, we parse the dom
// around the original selection, and derive an update from that.

editHandlers.compositionstart = editHandlers.compositionupdate = view => {
  DOMChange.start(view, true)
}

editHandlers.compositionend = (view, e) => {
  if (!view.inDOMChange) {
    // We received a compositionend without having seen any previous
    // events for the composition. If there's data in the event
    // object, we assume that it's a real change, and start a
    // composition. Otherwise, we just ignore it.
    if (e.data) DOMChange.start(view, true)
    else return
  }

  view.inDOMChange.compositionEnd()
}

editHandlers.input = view => DOMChange.start(view)

function captureCopy(view, dom) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  let wrap = document.body.appendChild(document.createElement("div"))
  wrap.appendChild(dom)
  wrap.style.cssText = "position: fixed; left: -10000px; top: 10px"
  let sel = getSelection(), range = document.createRange()
  range.selectNodeContents(dom)
  sel.removeAllRanges()
  sel.addRange(range)
  setTimeout(() => {
    document.body.removeChild(wrap)
    view.focus()
  }, 50)
}

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
// FIXME when Edge/Mobile Safari fixes this, change this to a version
// range test
const brokenClipboardAPI = browser.ie || browser.ios

handlers.copy = editHandlers.cut = (view, e) => {
  let sel = view.state.selection, cut = e.type == "cut"
  if (sel.empty) return

  // IE and Edge's clipboard interface is completely broken
  let data = brokenClipboardAPI ? null : e.clipboardData
  let slice = sel.content(), dom = serializeForClipboard(view, slice)
  if (data) {
    e.preventDefault()
    data.clearData()
    data.setData("text/html", dom.innerHTML)
    data.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n"))
  } else {
    captureCopy(view, dom)
  }
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
}

function sliceSingleNode(slice) {
  return slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1 ? slice.content.firstChild : null
}

function capturePaste(view, e) {
  let target = document.body.appendChild(document.createElement("div"))
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.contentEditable = "true"
  target.focus()
  setTimeout(() => {
    view.focus()
    document.body.removeChild(target)
    doPaste(view, target.textContent, target.innerHTML, e)
  }, 50)
}

function doPaste(view, text, html, e) {
  let slice = parseFromClipboard(view, text, html, view.shiftKey, view.state.selection.$from)
  if (!slice) return false

  if (view.someProp("handlePaste", f => f(view, e, slice))) return true

  let singleNode = sliceSingleNode(slice)
  let tr = singleNode ? view.state.tr.replaceSelectionWith(singleNode) : view.state.tr.replaceSelection(slice)
  view.dispatch(tr.scrollIntoView())
  return true
}

editHandlers.paste = (view, e) => {
  let data = brokenClipboardAPI ? null : e.clipboardData
  if (data && doPaste(view, data.getData("text/plain"), data.getData("text/html"), e))
    e.preventDefault()
  else
    capturePaste(view, e)
}

class Dragging {
  constructor(slice, move) {
    this.slice = slice
    this.move = move
  }
}

function dropPos(slice, $pos) {
  if (!slice || !slice.content.size) return $pos.pos
  let content = slice.content
  for (let i = 0; i < slice.openLeft; i++) content = content.firstChild.content
  for (let d = $pos.depth; d >= 0; d--) {
    let bias = d == $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1
    let insertPos = $pos.index(d) + (bias > 0 ? 1 : 0)
    if ($pos.node(d).canReplace(insertPos, insertPos, content))
      return bias == 0 ? $pos.pos : bias < 0 ? $pos.before(d + 1) : $pos.after(d + 1)
  }
  return $pos.pos
}

handlers.dragstart = (view, e) => {
  let mouseDown = view.mouseDown
  if (mouseDown) mouseDown.done()
  if (!e.dataTransfer) return

  let sel = view.state.selection
  let pos = sel.empty ? null : view.posAtCoords(eventCoords(e))
  if (pos && pos.pos >= sel.from && pos.pos <= sel.to) {
    // In selection
  } else if (mouseDown && mouseDown.mightDrag) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, mouseDown.mightDrag.pos)))
  } else {
    return
  }
  let slice = view.state.selection.content(), dom = serializeForClipboard(view, slice)
  e.dataTransfer.clearData()
  e.dataTransfer.setData("text/html", dom.innerHTML)
  e.dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n"))
  view.dragging = new Dragging(slice, !e.ctrlKey)
}

handlers.dragend = view => {
  window.setTimeout(() => view.dragging = null, 50)
}

editHandlers.dragover = editHandlers.dragenter = (_, e) => e.preventDefault()

editHandlers.drop = (view, e) => {
  let dragging = view.dragging
  view.dragging = null

  if (!e.dataTransfer) return

  let $mouse = view.state.doc.resolve(view.posAtCoords(eventCoords(e)).pos)
  if (!$mouse) return
  let slice = dragging && dragging.slice ||
      parseFromClipboard(view, e.dataTransfer.getData("text/plain"), e.dataTransfer.getData("text/html"), false, $mouse)
  if (!slice) return

  e.preventDefault()
  if (view.someProp("handleDrop", e, slice, dragging && dragging.move)) return
  let insertPos = dropPos(slice, view.state.doc.resolve($mouse.pos))

  let tr = view.state.tr
  if (dragging && dragging.move) tr.deleteSelection()

  let pos = tr.mapping.map(insertPos)
  let isNode = slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1
  if (isNode)
    tr.replaceRangeWith(pos, pos, slice.content.firstChild)
  else
    tr.replaceRange(pos, pos, slice)
  let $pos = tr.doc.resolve(pos)
  if (isNode && NodeSelection.isSelectable(slice.content.firstChild) &&
      $pos.nodeAfter && $pos.nodeAfter.sameMarkup(slice.content.firstChild))
    tr.setSelection(new NodeSelection($pos))
  else
    tr.setSelection(selectionBetween(view, $pos, tr.doc.resolve(tr.mapping.map(insertPos))))
  view.focus()
  view.dispatch(tr)
}

handlers.focus = (view, event) => {
  if (!view.focused) {
    view.dom.classList.add("ProseMirror-focused")
    view.focused = true
  }
  view.someProp("onFocus", f => { f(view, event) })
}

handlers.blur = (view, event) => {
  if (view.focused) {
    view.dom.classList.remove("ProseMirror-focused")
    view.focused = false
  }
  view.someProp("onBlur", f => { f(view, event) })
}

// Make sure all handlers get registered
for (let prop in editHandlers) handlers[prop] = editHandlers[prop]
