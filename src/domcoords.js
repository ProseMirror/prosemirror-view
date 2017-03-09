const {textRange, parentNode} = require("./dom")

function windowRect() {
  return {left: 0, right: window.innerWidth,
          top: 0, bottom: window.innerHeight}
}

function scrollRectIntoView(view, rect) {
  let scrollThreshold = view.someProp("scrollThreshold") || 0, scrollMargin = view.someProp("scrollMargin")
  if (scrollMargin == null) scrollMargin = 5
  for (let parent = view.dom;; parent = parentNode(parent)) {
    if (!parent) break
    let atBody = parent == document.body
    let bounding = atBody ? windowRect() : parent.getBoundingClientRect()
    let moveX = 0, moveY = 0
    if (rect.top < bounding.top + scrollThreshold)
      moveY = -(bounding.top - rect.top + scrollMargin)
    else if (rect.bottom > bounding.bottom - scrollThreshold)
      moveY = rect.bottom - bounding.bottom + scrollMargin
    if (rect.left < bounding.left + scrollThreshold)
      moveX = -(bounding.left - rect.left + scrollMargin)
    else if (rect.right > bounding.right - scrollThreshold)
      moveX = rect.right - bounding.right + scrollMargin
    if (moveX || moveY) {
      if (atBody) {
        window.scrollBy(moveX, moveY)
      } else {
        if (moveY) parent.scrollTop += moveY
        if (moveX) parent.scrollLeft += moveX
      }
    }
    if (atBody) break
  }
}
exports.scrollRectIntoView = scrollRectIntoView

// Store the scroll position of the editor's parent nodes, along with
// the top position of an element near the top of the editor, which
// will be used to make sure the visible viewport remains stable even
// when the size of the content above changes.
function storeScrollPos(view) {
  let rect = view.dom.getBoundingClientRect(), startY = Math.max(0, rect.top)
  let refDOM, refTop
  for (let x = (rect.left + rect.right) / 2, y = startY + 1;
       y < Math.min(innerHeight, rect.bottom); y += 5) {
    let dom = view.root.elementFromPoint(x, y)
    if (dom == view.dom || !view.dom.contains(dom)) continue
    let localRect = dom.getBoundingClientRect()
    if (localRect.top >= startY - 20) {
      refDOM = dom
      refTop = localRect.top
      break
    }
  }
  let stack = []
  for (let dom = view.dom; dom; dom = parentNode(dom)) {
    stack.push({dom, top: dom.scrollTop, left: dom.scrollLeft})
    if (dom == document.body) break
  }
  return {refDOM, refTop, stack}
}
exports.storeScrollPos = storeScrollPos

// Reset the scroll position of the editor's parent nodes to that what
// it was before, when storeScrollPos was called.
function resetScrollPos({refDOM, refTop, stack}) {
  let newRefTop = refDOM ? refDOM.getBoundingClientRect().top : 0
  let dTop = newRefTop == 0 ? 0 : newRefTop - refTop
  for (let i = 0; i < stack.length; i++) {
    let {dom, top, left} = stack[i]
    if (dom.scrollTop != top + dTop) dom.scrollTop = top + dTop
    if (dom.scrollLeft != left) dom.scrollLeft = left
  }
}
exports.resetScrollPos = resetScrollPos

function findOffsetInNode(node, coords) {
  let closest, dxClosest = 2e8, coordsClosest, offset = 0
  let rowBot = coords.top, rowTop = coords.top
  for (let child = node.firstChild, childIndex = 0; child; child = child.nextSibling, childIndex++) {
    let rects
    if (child.nodeType == 1) rects = child.getClientRects()
    else if (child.nodeType == 3) rects = textRange(child).getClientRects()
    else continue

    for (let i = 0; i < rects.length; i++) {
      let rect = rects[i]
      if (rect.top <= rowBot && rect.bottom >= rowTop) {
        rowBot = Math.max(rect.bottom, rowBot)
        rowTop = Math.min(rect.top, rowTop)
        let dx = rect.left > coords.left ? rect.left - coords.left
            : rect.right < coords.left ? coords.left - rect.right : 0
        if (dx < dxClosest) {
          closest = child
          dxClosest = dx
          coordsClosest = dx && closest.nodeType == 3 ? {left: rect.right < coords.left ? rect.right : rect.left, top: coords.top} : coords
          if (child.nodeType == 1 && dx)
            offset = childIndex + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0)
          continue
        }
      }
      if (!closest && (coords.left >= rect.right && coords.top >= rect.top ||
                       coords.left >= rect.left && coords.top >= rect.bottom))
        offset = childIndex + 1
    }
  }
  if (closest && closest.nodeType == 3) return findOffsetInText(closest, coordsClosest)
  if (!closest || (dxClosest && closest.nodeType == 1)) return {node, offset}
  return findOffsetInNode(closest, coordsClosest)
}

function findOffsetInText(node, coords) {
  let len = node.nodeValue.length
  let range = document.createRange()
  for (let i = 0; i < len; i++) {
    range.setEnd(node, i + 1)
    range.setStart(node, i)
    let rect = singleRect(range, 1)
    if (rect.top == rect.bottom) continue
    if (rect.left - 1 <= coords.left && rect.right + 1 >= coords.left &&
        rect.top - 1 <= coords.top && rect.bottom + 1 >= coords.top)
      return {node, offset: i + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0)}
  }
  return {node, offset: 0}
}

function targetKludge(dom, coords) {
  if (/^[uo]l$/i.test(dom.nodeName)) {
    for (let child = dom.firstChild; child; child = child.nextSibling) {
      if (!child.pmViewDesc || !/^li$/i.test(child.nodeName)) continue
      let childBox = child.getBoundingClientRect()
      if (coords.left > childBox.left - 2) break
      if (childBox.top <= coords.top && childBox.bottom >= coords.top) return child
    }
  }
  return dom
}

// Given an x,y position on the editor, get the position in the document.
function posAtCoords(view, coords) {
  let elt = view.root.elementFromPoint(coords.left, coords.top + 1)
  if (!elt) return null
  elt = targetKludge(elt, coords)
  if (!view.dom.contains(elt.nodeType != 1 ? elt.parentNode : elt)) return null

  let {node, offset} = findOffsetInNode(elt, coords), bias = -1
  if (node.nodeType == 1 && !node.firstChild) {
    let rect = node.getBoundingClientRect()
    bias = rect.left != rect.right && coords.left > (rect.left + rect.right) / 2 ? 1 : -1
  }

  let desc = view.docView.nearestDesc(elt, true)
  return {pos: view.docView.posFromDOM(node, offset, bias),
          inside: desc ? desc.posAtStart - desc.border : -1}
}
exports.posAtCoords = posAtCoords

function singleRect(object, bias) {
  let rects = object.getClientRects()
  return !rects.length ? object.getBoundingClientRect() : rects[bias < 0 ? 0 : rects.length - 1]
}

// : (EditorView, number) → {left: number, top: number, right: number, bottom: number}
// Given a position in the document model, get a bounding box of the
// character at that position, relative to the window.
function coordsAtPos(view, pos) {
  let {node, offset} = view.docView.domFromPos(pos)
  let side, rect
  if (node.nodeType == 3) {
    if (offset < node.nodeValue.length) {
      rect = singleRect(textRange(node, offset, offset + 1), -1)
      side = "left"
    }
    if ((!rect || rect.left == rect.right) && offset) {
      rect = singleRect(textRange(node, offset - 1, offset), 1)
      side = "right"
    }
  } else if (node.firstChild) {
    if (offset < node.childNodes.length) {
      let child = node.childNodes[offset]
      rect = singleRect(child.nodeType == 3 ? textRange(child) : child, -1)
      side = "left"
    }
    if ((!rect || rect.top == rect.bottom) && offset) {
      let child = node.childNodes[offset - 1]
      rect = singleRect(child.nodeType == 3 ? textRange(child) : child, 1)
      side = "right"
    }
  } else {
    rect = node.getBoundingClientRect()
    side = "left"
  }
  let x = rect[side]
  return {top: rect.top, bottom: rect.bottom, left: x, right: x}
}
exports.coordsAtPos = coordsAtPos

function withFlushedState(view, state, f) {
  let viewState = view.state, active = view.root.activeElement
  if (viewState != state || !view.inDOMChange) view.updateState(state)
  if (active != view.dom) view.focus()
  try {
    return f()
  } finally {
    if (viewState != state) view.updateState(viewState)
    if (active != view.dom) active.focus()
  }
}

// : (EditorView, number, number)
// Whether vertical position motion in a given direction
// from a position would leave a text block.
function endOfTextblockVertical(view, state, dir) {
  let $pos = dir == "up" ? state.selection.$from : state.selection.$to
  if (!$pos.depth) return false
  return withFlushedState(view, state, () => {
    let dom = view.docView.domAfterPos($pos.before())
    let coords = coordsAtPos(view, $pos.pos)
    for (let child = dom.firstChild; child; child = child.nextSibling) {
      let boxes
      if (child.nodeType == 1) boxes = child.getClientRects()
      else if (child.nodeType == 3) boxes = textRange(child, 0, child.nodeValue.length).getClientRects()
      else continue
      for (let i = 0; i < boxes.length; i++) {
        let box = boxes[i]
        if (dir == "up" ? box.bottom < coords.top + 1 : box.top > coords.bottom - 1)
          return false
      }
    }
    return true
  })
}

const maybeRTL = /[\u0590-\u08ac]/

function endOfTextblockHorizontal(view, state, dir) {
  let {$head, empty} = state.selection
  if (!empty || !$head.parent.isTextblock || !$head.depth) return false
  let offset = $head.parentOffset, atStart = !offset, atEnd = offset == $head.parent.content.size
  // If the textblock is all LTR and the cursor isn't at the sides, we don't need to touch the DOM
  if (!atStart && !atEnd && !maybeRTL.test($head.parent.textContent)) return false
  let sel = getSelection()
  // Fall back to a primitive approach if the necessary selection method isn't supported (Edge)
  if (!sel.modify) return dir == "left" || dir == "backward" ? atStart : atEnd

  return withFlushedState(view, state, () => {
    // This is a huge hack, but appears to be the best we can
    // currently do: use `Selection.modify` to move the selection by
    // one character, and see if that moves the cursor out of the
    // textblock (or doesn't move it at all, when at the start/end of
    // the document).
    let oldRange = sel.getRangeAt(0)
    sel.modify("move", dir, "character")
    let parentDOM = view.docView.domAfterPos($head.before())
    let result = !parentDOM.contains(sel.focusNode.nodeType == 1 ? sel.focusNode : sel.focusNode.parentNode) ||
        view.docView.posFromDOM(sel.focusNode, sel.focusOffset) == $head.pos
    // Restore the previous selection
    sel.removeAllRanges()
    sel.addRange(oldRange)
    return result
  })
}

let cachedState = null, cachedDir = null, cachedResult = false
function endOfTextblock(view, state, dir) {
  if (cachedState == state && cachedDir == dir) return cachedResult
  cachedState = state; cachedDir = dir
  return cachedResult = dir == "up" || dir == "down"
    ? endOfTextblockVertical(view, state, dir)
    : endOfTextblockHorizontal(view, state, dir)
}
exports.endOfTextblock = endOfTextblock
