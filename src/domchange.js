const {Fragment, DOMParser} = require("prosemirror-model")
const {Selection} = require("prosemirror-state")

const {TrackMappings} = require("./trackmappings")

class DOMChange {
  constructor(view, id, composing) {
    this.view = view
    this.id = id
    this.state = view.state
    this.composing = composing
    this.from = this.to = null
    this.timeout = composing ? null : setTimeout(() => this.finish(), 20)
    this.mappings = new TrackMappings(view.state)
  }

  addRange(from, to) {
    if (this.from == null) {
      this.from = from
      this.to = to
    } else {
      this.from = Math.min(from, this.from)
      this.to = Math.max(to, this.to)
    }
  }

  changedRange() {
    if (this.from == null) return rangeAroundSelection(this.state.selection)
    let $from = this.state.doc.resolve(this.from), $to = this.state.doc.resolve(this.to)
    let shared = $from.sharedDepth(this.to)
    return {from: $from.before(shared + 1), to: $to.after(shared + 1)}
  }

  finish(force) {
    clearTimeout(this.timeout)
    if (this.composing && !force) return
    let range = this.changedRange()
    if (this.from == null) this.view.docView.markDirty(range.from, range.to)
    else this.view.docView.markDirty(this.from, this.to)
    this.view.inDOMChange = null
    readDOMChange(this, this.state, range)
    // If the reading didn't result in a view update, force one by
    // resetting the view to its current state.
    if (this.view.docView.dirty) this.view.updateState(this.view.state)
  }

  compositionEnd() {
    if (this.composing) {
      this.composing = false
      this.timeout = setTimeout(() => this.finish(), 50)
    }
  }

  static start(view, composing) {
    if (view.inDOMChange) {
      if (composing) {
        clearTimeout(view.inDOMChange.timeout)
        view.inDOMChange.composing = true
      }
    } else {
      let id = Math.floor(Math.random() * 0xffffffff)
      view.inDOMChange = new DOMChange(view, id, composing)
    }
  }
}
exports.DOMChange = DOMChange

// Note that all referencing and parsing is done with the
// start-of-operation selection and document, since that's the one
// that the DOM represents. If any changes came in in the meantime,
// the modification is mapped over those before it is applied, in
// readDOMChange.

function parseBetween(view, oldState, from, to) {
  let {node: parent, offset: startOff} = view.docView.domFromPos(from, -1)
  let {node: parentRight, offset: endOff} = view.docView.domFromPos(to, 1)
  if (parent != parentRight) return null
  // If there's non-view nodes directly after the end of this region,
  // fail and let the caller try again with a wider range.
  if (endOff == parent.childNodes.length) for (let scan = parent; scan != view.content;) {
    if (scan.nextSibling) {
      if (!scan.nextSibling.pmViewDesc) return null
      break
    }
    scan = scan.parentNode
  }

  let domSel = view.root.getSelection(), find = null
  if (domSel.anchorNode && view.content.contains(domSel.anchorNode)) {
    find = [{node: domSel.anchorNode, offset: domSel.anchorOffset}]
    if (!domSel.isCollapsed)
      find.push({node: domSel.focusNode, offset: domSel.focusOffset})
  }
  let startDoc = oldState.doc
  let parser = view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
  let $from = startDoc.resolve(from)
  let sel = null, doc = parser.parse(parent, {
    topNode: $from.parent.copy(),
    topStart: $from.index(),
    topOpen: true,
    from: startOff,
    to: endOff,
    preserveWhitespace: true,
    editableContent: true,
    findPositions: find,
    ruleFromNode
  })
  if (find && find[0].pos != null) {
    let anchor = find[0].pos, head = find[1] && find[1].pos
    if (head == null) head = anchor
    sel = {anchor: anchor + from, head: head + from}
  }
  return {doc, sel}
}

function ruleFromNode(dom) {
  let desc = dom.pmViewDesc
  if (desc) return desc.parseRule()
  else if (dom.nodeName == "BR" && dom.parentNode && dom.parentNode.lastChild == dom) return {ignore: true}
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

  if ($from.sameParent($to) && $from.parent.isTextblock && $from.parentOffset && $to.parentOffset < $to.parent.content.size) {
    let startOff = Math.max(0, $from.parentOffset)
    let size = $from.parent.content.size
    let endOff = Math.min(size, $to.parentOffset)

    if (startOff > 0)
      startOff = $from.parent.childBefore(startOff).offset
    if (endOff < size) {
      let after = $from.parent.childAfter(endOff)
      endOff = after.offset + after.node.nodeSize
    }
    let nodeStart = $from.start()
    return {from: nodeStart + startOff, to: nodeStart + endOff}
  } else {
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
}

function keyEvent(keyCode, key) {
  let event = document.createEvent("Event")
  event.initEvent("keydown", true, true)
  event.keyCode = keyCode
  event.key = event.code = key
  return event
}

function readDOMChange(domChange, oldState, range) {
  let parseResult, doc = oldState.doc, view = domChange.view
  // If there have been changes since this DOM update started, we must
  // map our start and end positions, as well as the new selection
  // positions, through them.
  let mapping = domChange.mappings.getMapping(view.state)
  if (!mapping) return

  for (;;) {
    parseResult = parseBetween(view, oldState, range.from, range.to)
    if (parseResult) break
    let $from = doc.resolve(range.from), $to = doc.resolve(range.to)
    range = {from: $from.depth ? $from.before() : 0,
             to: $to.depth ? $to.after() : doc.content.size}
  }
  let {doc: parsed, sel: parsedSel} = parseResult

  let compare = doc.slice(range.from, range.to)
  let change = findDiff(compare.content, parsed.content, range.from, oldState.selection.from)

  if (!change) {
    if (parsedSel) {
      let sel = resolveSelection(view.state.doc, mapping, parsedSel)
      if (!sel.eq(view.state.selection)) view.props.onAction(sel.action())
    }
    return
  }

  let $from = parsed.resolveNoCache(change.start - range.from)
  let $to = parsed.resolveNoCache(change.endB - range.from)
  let nextSel
  // If this looks like the effect of pressing Enter, just dispatch an
  // Enter key instead.
  if (!$from.sameParent($to) && $from.pos < parsed.content.size &&
      (nextSel = Selection.findFrom(parsed.resolve($from.pos + 1), 1, true)) &&
      nextSel.head == $to.pos &&
      view.someProp("handleKeyDown", f => f(view, keyEvent(13, "Enter"))))
    return
  if (oldState.selection.anchor > change.start &&
      looksLikeJoin(doc, change.start, change.endA, $from, $to) &&
      view.someProp("handleKeyDown", f => f(view, keyEvent(8, "Backspace"))))
    return

  let from = mapping.map(change.start), to = mapping.map(change.endA, -1)

  let tr = view.state.tr, handled = false, markChange, $from1
  if ($from.sameParent($to) && $from.parent.isTextblock && $from.pos != $to.pos) {
    if (change.endA == change.endB &&
        ($from1 = doc.resolve(change.start)) &&
        (markChange = isMarkChange($from.parent.content.cut($from.parentOffset, $to.parentOffset),
                                   $from1.parent.content.cut($from1.parentOffset, change.endA - $from1.start())))) {
      // Adding or removing a mark
      if (markChange.type == "add") tr.addMark(from, to, markChange.mark)
      else tr.removeMark(from, to, markChange.mark)
      handled = true
    } else if ($from.parent.child($from.index()).isText && $from.index() == $to.index() - ($to.textOffset ? 0 : 1)) {
      // Both positions in the same text node -- simply insert text
      let text = $from.parent.textBetween($from.parentOffset, $to.parentOffset)
      if (view.someProp("handleTextInput", f => f(view, from, to, text))) return
      tr.insertText(text, from, to)
      handled = true
    }
  }

  if (!handled)
    tr.replace(from, to, parsed.slice(change.start - range.from, change.endB - range.from))
  if (parsedSel) tr.setSelection(resolveSelection(tr.doc, mapping, parsedSel))
  view.props.onAction(tr.scrollAction())
}

function resolveSelection(doc, mapping, parsedSel) {
  return Selection.between(doc.resolve(mapping.map(parsedSel.anchor)),
                           doc.resolve(mapping.map(parsedSel.head)))
}

// : (Fragment, Fragment) → ?{mark: Mark, type: string}
// Given two same-length, non-empty fragments of inline content,
// determine whether the first could be created from the second by
// removing or adding a single mark type.
function isMarkChange(cur, prev) {
  let curMarks = cur.firstChild.marks, prevMarks = prev.firstChild.marks
  let added = curMarks, removed = prevMarks, type, mark, update
  for (let i = 0; i < prevMarks.length; i++) added = prevMarks[i].removeFromSet(added)
  for (let i = 0; i < curMarks.length; i++) removed = curMarks[i].removeFromSet(removed)
  if (added.length == 1 && removed.length == 0) {
    mark = added[0]
    type = "add"
    update = node => node.mark(mark.addToSet(node.marks))
  } else if (added.length == 0 && removed.length == 1) {
    mark = removed[0]
    type = "remove"
    update = node => node.mark(mark.removeFromSet(node.marks))
  } else {
    return null
  }
  let updated = []
  for (let i = 0; i < prev.childCount; i++) updated.push(update(prev.child(i)))
  if (Fragment.from(updated).eq(cur)) return {mark, type}
}

function looksLikeJoin(old, start, end, $newStart, $newEnd) {
  if (!$newStart.parent.isTextblock ||
      // The content must have shrunk
      end - start <= $newEnd.pos - $newStart.pos ||
      // newEnd must point directly at or after the end of the block that newStart points into
      skipClosingAndOpening($newStart, true, false) < $newEnd.pos)
    return false

  let $start = old.resolve(start)
  // Start must be at the end of a block
  if ($start.parentOffset < $start.parent.content.size || !$start.parent.isTextblock)
    return false
  let $next = old.resolve(skipClosingAndOpening($start, true, true))
  // The next textblock must start before end and end near it
  if (!$next.parent.isTextblock || $next.pos > end ||
      skipClosingAndOpening($next, true, false) < end)
    return false

  // The fragments after the join point must match
  return $newStart.parent.content.cut($newStart.parentOffset).eq($next.parent.content)
}

function skipClosingAndOpening($pos, fromEnd, mayOpen) {
  let depth = $pos.depth, end = fromEnd ? $pos.end() : $pos.pos
  while (depth > 0 && (fromEnd || $pos.indexAfter(depth) == $pos.node(depth).childCount)) {
    depth--
    end++
    fromEnd = false
  }
  if (mayOpen) {
    let next = $pos.node(depth).maybeChild($pos.indexAfter(depth))
    while (next && !next.isLeaf) {
      next = next.firstChild
      end++
    }
  }
  return end
}

function findDiff(a, b, pos, preferedStart) {
  let start = a.findDiffStart(b, pos)
  if (!start) return null
  let {a: endA, b: endB} = a.findDiffEnd(b, pos + a.size, pos + b.size)
  if (endA < start && a.size < b.size) {
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
