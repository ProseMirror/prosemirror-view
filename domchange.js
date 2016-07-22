const {Mark} = require("../model")

const {Selection} = require("../state")
const {DOMFromPos, DOMFromPosFromEnd} = require("./dompos")

function readInputChange(view, oldState) {
  return readDOMChange(view, oldState, rangeAroundSelection(oldState.selection))
}
exports.readInputChange = readInputChange

function readCompositionChange(view, oldState, margin) {
  return readDOMChange(view, oldState, rangeAroundComposition(oldState.selection, margin))
}
exports.readCompositionChange = readCompositionChange

// Note that all referencing and parsing is done with the
// start-of-operation selection and document, since that's the one
// that the DOM represents. If any changes came in in the meantime,
// the modification is mapped over those before it is applied, in
// readDOMChange.

function parseBetween(view, oldState, from, to) {
  let {node: parent, offset: startOff} = DOMFromPos(view, from, true)
  let {node: parentRight, offset: endOff} = DOMFromPosFromEnd(view, to)
  if (parent != parentRight) return null
  while (startOff) {
    let prev = parent.childNodes[startOff - 1]
    if (prev.nodeType != 1 || !prev.hasAttribute("pm-offset")) --startOff
    else break
  }
  while (endOff < parent.childNodes.length) {
    let next = parent.childNodes[endOff]
    if (next.nodeType != 1 || !next.hasAttribute("pm-offset")) ++endOff
    else break
  }
  let domSel = window.getSelection(), find = null
  if (domSel.anchorNode && view.content.contains(domSel.anchorNode)) {
    find = [{node: domSel.anchorNode, offset: domSel.anchorOffset}]
    if (!domSel.isCollapsed)
      find.push({node: domSel.focusNode, offset: domSel.focusOffset})
  }
  let startDoc = oldState.doc
  let sel = null, doc = startDoc.type.schema.parseDOM(parent, {
    topNode: startDoc.resolve(from).parent.copy(),
    from: startOff,
    to: endOff,
    preserveWhitespace: true,
    editableContent: true,
    findPositions: find
  })
  if (find && find[0].pos != null) {
    let anchor = find[0].pos, head = find[1] && find[1].pos
    if (head == null) head = anchor
    sel = {anchor: anchor + from, head: head + from}
  }
  return {doc, sel}
}

function isAtEnd($pos, depth) {
  for (let i = depth || 0; i < $pos.depth; i++)
    if ($pos.index(i) + 1 < $pos.node(i).childCount) return false
  return $pos.parentOffset == $pos.parent.content.size
}
function isAtStart($pos, depth) {
  for (let i = depth || 0; i < $pos.depth; i++)
    if ($pos.index(0) > 0) return false
  return $pos.parentOffset == 0
}

function rangeAroundSelection(selection) {
  let {$from, $to} = selection
  // When the selection is entirely inside a text block, use
  // rangeAroundComposition to get a narrow range.
  if ($from.sameParent($to) && $from.parent.isTextblock && $from.parentOffset && $to.parentOffset < $to.parent.content.size)
    return rangeAroundComposition(selection, 0)

  for (let depth = 0;; depth++) {
    let fromStart = isAtStart($from, depth + 1), toEnd = isAtEnd($to, depth + 1)
    if (fromStart || toEnd || $from.index(depth) != $to.index(depth) || $to.node(depth).isTextblock) {
      let from = $from.before(depth + 1), to = $to.after(depth + 1)
      if (fromStart && $from.index(depth) > 0)
        from -= $from.node(depth).child($from.index(depth) - 1).nodeSize
      if (toEnd && $to.index(depth) + 1 < $to.node(depth).childCount)
        to += $to.node(depth).child($to.index(depth) + 1).nodeSize
      return {from, to}
    }
  }
}

function rangeAroundComposition(selection, margin) {
  let {$from, $to} = selection
  if (!$from.sameParent($to)) return rangeAroundSelection(selection)
  let startOff = Math.max(0, $from.parentOffset - margin)
  let size = $from.parent.content.size
  let endOff = Math.min(size, $to.parentOffset + margin)

  if (startOff > 0)
    startOff = $from.parent.childBefore(startOff).offset
  if (endOff < size) {
    let after = $from.parent.childAfter(endOff)
    endOff = after.offset + after.node.nodeSize
  }
  let nodeStart = $from.start()
  return {from: nodeStart + startOff, to: nodeStart + endOff}
}

function readDOMChange(view, oldState, range) {
  let parseResult, doc = oldState.doc
  for (;;) {
    parseResult = parseBetween(view, oldState, range.from, range.to)
    if (parseResult) break
    range = {from: doc.resolve(range.from).before(),
             to: doc.resolve(range.to).after()}
  }
  let {doc: parsed, sel: parsedSel} = parseResult

  let compare = doc.slice(range.from, range.to)
  let change = findDiff(compare.content, parsed.content, range.from, oldState.selection.from)
  if (!change) return false

  // Mark nodes touched by this change as 'to be redrawn'
  markDirtyFor(view, doc, change.start, change.endA)

  let $from = parsed.resolveNoCache(change.start - range.from)
  let $to = parsed.resolveNoCache(change.endB - range.from)
  let nextSel, text
  // If this looks like the effect of pressing Enter, just dispatch an
  // Enter key instead.
  if (!$from.sameParent($to) && $from.pos < parsed.content.size &&
      (nextSel = Selection.findFrom(parsed.resolve($from.pos + 1), 1, true)) &&
      nextSel.head == $to.pos &&
      view.dispatchKey("Enter"))
    return

  let from = change.start, to = change.endA
  // If there have been changes since this DOM update started, we must
  // map our start and end positions, as well as the new selection
  // positions, through them.
  let mapping = view.state.view.domChangeMapping
  if (mapping) {
    from = mapping.map(from)
    to = mapping.map(to)
    if (parsedSel) parsedSel = {anchor: mapping.map(parsedSel.anchor),
                                head: mapping.map(parsedSel.head)}
  }

  let tr = view.state.tr
  if ($from.sameParent($to) && $from.parent.isTextblock &&
      (text = uniformTextBetween(parsed, $from.pos, $to.pos)) != null) {
    if (view.someProp("onTextInput", f => f(view.state, from, to, text))) return
    tr.insertText(text, from, to)
  } else {
    tr.replace(from, to, parsed.slice(change.start - range.from, change.endB - range.from))
  }

  if (parsedSel)
    tr.setSelection(Selection.between(tr.doc.resolve(parsedSel.anchor),
                                      tr.doc.resolve(parsedSel.head)))
  view.props.onAction(tr.scrollAction())
}

function uniformTextBetween(node, from, to) {
  let result = "", valid = true, marks = null
  node.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline && pos < from) return
    if (!node.isText) return valid = false
    if (!marks) marks = node.marks
    else if (!Mark.sameSet(marks, node.marks)) valid = false
    result += node.text.slice(Math.max(0, from - pos), to - pos)
  })
  return valid ? result : null
}

function findDiff(a, b, pos, preferedStart) {
  let start = a.findDiffStart(b, pos)
  if (!start) return null
  let {a: endA, b: endB} = a.findDiffEnd(b, pos + a.size, pos + b.size)
  if (endA < start) {
    let move = preferedStart <= start && preferedStart >= endA ? start - preferedStart : 0
    start -= move
    endB = start + (endB - endA)
    endA = start
  } else if (endB < start) {
    let move = preferedStart <= start && preferedStart >= endB ? start - preferedStart : 0
    start -= move
    endA = start + (endA - endB)
    endB = start
  }
  return {start, endA, endB}
}

function markDirtyFor(view, doc, start, end) {
  let $start = doc.resolve(start), $end = doc.resolve(end), same = $start.sameDepth($end)
  if (same == 0)
    view.markAllDirty()
  else
    view.markRangeDirty($start.before(same), $start.after(same), doc)
}
