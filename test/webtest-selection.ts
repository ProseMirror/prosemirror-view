import {doc, blockquote, p, em, img as img_, strong, code, code_block, br, hr, ul, li} from "prosemirror-test-builder"
import ist from "ist"
import {Selection, NodeSelection} from "prosemirror-state"
import {Decoration, DecorationSet, EditorView} from "prosemirror-view"
import {Node as PMNode} from "prosemirror-model"
import {tempEditor, findTextNode} from "./view"

const img = img_({src: "data:image/gif;base64,R0lGODlhBQAFAIABAAAAAP///yH5BAEKAAEALAAAAAAFAAUAAAIEjI+pWAA7"})

function allPositions(doc: PMNode) {
  let found: number[] = []
  function scan(node: PMNode, start: number) {
    if (node.isTextblock) {
      for (let i = 0; i <= node.content.size; i++) found.push(start + i)
    } else {
      node.forEach((child, offset) => scan(child, start + offset + 1))
    }
  }
  scan(doc, 0)
  return found
}

function setDOMSel(node: Node, offset: number) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  let sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function getSel() {
  let sel = window.getSelection()!
  let node = sel.focusNode, offset = sel.focusOffset
  while (node && node.nodeType != 3) {
    let after = offset < node.childNodes.length && node.childNodes[offset]
    let before = offset > 0 && node.childNodes[offset - 1]
    if (after) { node = after; offset = 0 }
    else if (before) { node = before; offset = node.nodeType == 3 ? node.nodeValue!.length : node.childNodes.length }
    else break
  }
  return {node: node, offset: offset}
}

function setSel(view: EditorView, sel: number | Selection) {
  if (typeof sel == "number") sel = Selection.near(view.state.doc.resolve(sel))
  view.dispatch(view.state.tr.setSelection(sel))
}

function event(code: number) {
  let event = document.createEvent("Event")
  event.initEvent("keydown", true, true)
  ;(event as any).keyCode = code
  return event
}
const LEFT = 37, RIGHT = 39, UP = 38, DOWN = 40

if (!document.hasFocus()) console["warn"]("Document doesn't have focus. Skipping some tests.")

describe("EditorView", () => {
  it("can read the DOM selection", () => {
    // disabled when the document doesn't have focus, since that causes this to fail
    if (!document.hasFocus()) return

    let view = tempEditor({doc: doc(p("one"), hr(), blockquote(p("two")))})
    function test(node: Node, offset: number, expected: number) {
      setDOMSel(node, offset)
      view.dom.focus()
      view.domObserver.flush()
      let sel = view.state.selection
      ist(sel.head == null ? sel.from : sel.head, expected)
    }
    let one = findTextNode(view.dom, "one")!
    let two = findTextNode(view.dom, "two")!
    test(one, 0, 1)
    test(one, 1, 2)
    test(one, 3, 4)
    test(one.parentNode!, 0, 1)
    test(one.parentNode!, 1, 4)
    test(two, 0, 8)
    test(two, 3, 11)
    test(two.parentNode!, 1, 11)
    test(view.dom, 1, 4)
    test(view.dom, 2, 8)
    test(view.dom, 3, 11)
  })

  it("syncs the DOM selection with the editor selection", () => {
    // disabled when the document doesn't have focus, since that causes this to fail
    if (!document.hasFocus()) return

    let view = tempEditor({doc: doc(p("one"), hr(), blockquote(p("two")))})
    function test(pos: number, node: Node, offset: number) {
      setSel(view, pos)
      let sel = getSel()
      ist(sel.node, node)
      ist(sel.offset, offset)
    }
    let one = findTextNode(view.dom, "one")!
    let two = findTextNode(view.dom, "two")!
    view.focus()
    test(1, one, 0)
    test(2, one, 1)
    test(4, one, 3)
    test(8, two, 0)
    test(10, two, 2)
  })

  it("returns sensible screen coordinates", () => {
    let view = tempEditor({doc: doc(p("one"), p("two"))})

    let p00 = view.coordsAtPos(1)
    let p01 = view.coordsAtPos(2)
    let p03 = view.coordsAtPos(4)
    let p10 = view.coordsAtPos(6)
    let p13 = view.coordsAtPos(9)

    ist(p00.bottom, p00.top, ">")
    ist(p13.bottom, p13.top, ">")

    ist(p00.top, p01.top)
    ist(p01.top, p03.top)
    ist(p00.bottom, p03.bottom)
    ist(p10.top, p13.top)

    ist(p01.left, p00.left, ">")
    ist(p03.left, p01.left, ">")
    ist(p10.top, p00.top, ">")
    ist(p13.left, p10.left, ">")
  })

  it("returns proper coordinates in code blocks", () => {
    let view = tempEditor({doc: doc(code_block("a\nb\n"))}), p = []
    for (let i = 1; i <= 5; i++) p.push(view.coordsAtPos(i))
    let [p0, p1, p2, p3, p4] = p
    ist(p0.top, p1.top)
    ist(p0.left, p1.left, "<")
    ist(p2.top, p1.top, ">")
    ist(p2.top, p3.top)
    ist(p2.left, p3.left, "<")
    ist(p2.left, p0.left)
    ist(p4.top, p3.top, ">")
    // This one shows a small (0.01 pixel) difference in Firefox for
    // some reason.
    ist(Math.round(p4.left), Math.round(p2.left))
  })

  it("produces sensible screen coordinates in corner cases", () => {
    let view = tempEditor({doc: doc(p("one", em("two", strong("three"), img), br(), code("foo")), p())})
    return new Promise(ok => {
      setTimeout(() => {
        allPositions(view.state.doc).forEach(pos => {
          let coords = view.coordsAtPos(pos)
          let found = view.posAtCoords({top: coords.top + 1, left: coords.left})!.pos
          ist(found, pos)
          setSel(view, pos)
        })
        ok(null)
      }, 20)
    })
  })

  it("doesn't return zero-height rectangles after leaves", () => {
    let view = tempEditor({doc: doc(p(img))})
    let coords = view.coordsAtPos(2, 1)
    ist(coords.bottom - coords.top, 5, ">")
  })

  it("produces horizontal rectangles for positions between blocks", () => {
    let view = tempEditor({doc: doc(p("ha"), hr(), blockquote(p("ba")))})
    let a = view.coordsAtPos(0)
    ist(a.top, a.bottom)
    ist(a.top, (view.dom.firstChild as HTMLElement).getBoundingClientRect().top)
    ist(a.left, a.right, "<")
    let b = view.coordsAtPos(4)
    ist(b.top, b.bottom)
    ist(b.top, a.top, ">")
    ist(b.left, b.right, "<")
    let c = view.coordsAtPos(5)
    ist(c.top, c.bottom)
    ist(c.top, b.top, ">")
    let d = view.coordsAtPos(6)
    ist(d.top, d.bottom)
    ist(d.left, d.right, "<")
    ist(d.top, view.dom.getBoundingClientRect().bottom, "<")
  })

  it("produces sensible screen coordinates around line breaks", () => {
    let view = tempEditor({doc: doc(p("one two three four five-six-seven-eight"))})
    function afterSpace(pos: number) {
      return pos > 0 && view.state.doc.textBetween(pos - 1, pos) == " "
    }
    view.dom.style.width = "4em"
    let prevBefore: {left: number, top: number, right: number, bottom: number} | undefined
    let prevAfter: {left: number, top: number, right: number, bottom: number} | undefined
    allPositions(view.state.doc).forEach(pos => {
      let coords = view.coordsAtPos(pos, 1)
      if (prevAfter)
        ist(prevAfter.top < coords.top || prevAfter.top == coords.top && prevAfter.left < coords.left)
      prevAfter = coords
      let found = view.posAtCoords({top: coords.top + 1, left: coords.left})!.pos
      ist(found, pos)
      let coordsBefore = view.coordsAtPos(pos, -1)
      if (prevBefore)
        ist(prevBefore.top < coordsBefore.top ||
            prevBefore.top == coordsBefore.top &&
              (prevBefore.left < coordsBefore.left || (afterSpace(pos) && prevBefore.left == coordsBefore.left)))
      prevBefore = coordsBefore
    })
  })

  it("can find coordinates on node boundaries", () => {
    let view = tempEditor({doc: doc(p("one ", em("two"), " ", em(strong("three"))))})
    let prev: {left: number, top: number, right: number, bottom: number}
    allPositions(view.state.doc).forEach(pos => {
      let coords = view.coordsAtPos(pos, 1)
      if (prev)
        ist(prev.top < coords.top || Math.abs(prev.top - coords.top) < 4 && prev.left < coords.left)
      prev = coords
    })
  })

  it("finds proper coordinates in RTL text", () => {
    let view = tempEditor({doc: doc(p("مرآة نثرية"))})
    view.dom.style.direction = "rtl"
    let prev: {left: number, top: number, right: number, bottom: number}
    allPositions(view.state.doc).forEach(pos => {
      let coords = view.coordsAtPos(pos, 1)
      if (prev)
        ist(prev.top < coords.top || Math.abs(prev.top - coords.top) < 4 && prev.left > coords.left)
      prev = coords
    })
  })

  it("can go back and forth between screen coordsa and document positions", () => {
    let view = tempEditor({doc: doc(p("one"), blockquote(p("two"), p("three")))})
    ;[1, 2, 4, 7, 14, 15].forEach(pos => {
      let coords = view.coordsAtPos(pos)
      let found = view.posAtCoords({top: coords.top + 1, left: coords.left})!.pos
      ist(found, pos)
    })
  })

  it("returns correct screen coordinates for wrapped lines", () => {
    let view = tempEditor({})
    let top = view.coordsAtPos(1), pos = 1, end: {left: number, top: number, right: number, bottom: number} | undefined
    for (let i = 0; i < 100; i++) {
      view.dispatch(view.state.tr.insertText("a bc de fg h"))
      pos += 12
      end = view.coordsAtPos(pos)!
      if (end.bottom > top.bottom + 4) break
    }
    ist(view.posAtCoords({left: end!.left + 50, top: end!.top + 5})!.pos, pos)
  })

  it("makes arrow motion go through selectable inline nodes", () => {
    let view = tempEditor({doc: doc(p("foo<a>", img, "bar"))})
    view.dispatchEvent(event(RIGHT))
    ist(view.state.selection.from, 4)
    view.dispatchEvent(event(RIGHT))
    ist(view.state.selection.head, 5)
    ist(view.state.selection.anchor, 5)
    view.dispatchEvent(event(LEFT))
    ist(view.state.selection.from, 4)
    view.dispatchEvent(event(LEFT))
    ist(view.state.selection.head, 4)
    ist(view.state.selection.anchor, 4)
  })

  it("makes arrow motion go through selectable block nodes", () => {
    let view = tempEditor({doc: doc(p("hello<a>"), hr(), ul(li(p("there"))))})
    view.dispatchEvent(event(DOWN))
    ist(view.state.selection.from, 7)
    setSel(view, 11)
    view.dispatchEvent(event(UP))
    ist(view.state.selection.from, 7)
  })

  it("supports arrow motion through adjacent blocks", () => {
    let view = tempEditor({doc: doc(blockquote(p("hello<a>")), hr(), hr(), p("there"))})
    view.dispatchEvent(event(DOWN))
    ist(view.state.selection.from, 9)
    view.dispatchEvent(event(DOWN))
    ist(view.state.selection.from, 10)
    setSel(view, 14)
    view.dispatchEvent(event(UP))
    ist(view.state.selection.from, 10)
    view.dispatchEvent(event(UP))
    ist(view.state.selection.from, 9)
  })

  it("support horizontal motion through blocks", () => {
    let view = tempEditor({doc: doc(p("foo<a>"), hr(), hr(), p("bar"))})
    view.dispatchEvent(event(RIGHT))
    ist(view.state.selection.from, 5)
    view.dispatchEvent(event(RIGHT))
    ist(view.state.selection.from, 6)
    view.dispatchEvent(event(RIGHT))
    ist(view.state.selection.head, 8)
    view.dispatchEvent(event(LEFT))
    ist(view.state.selection.from, 6)
    view.dispatchEvent(event(LEFT))
    ist(view.state.selection.from, 5)
    view.dispatchEvent(event(LEFT))
    ist(view.state.selection.head, 4)
  })

  it("allows moving directly from an inline node to a block node", () => {
    let view = tempEditor({doc: doc(p("foo", img), hr(), p(img, "bar"))})
    setSel(view, NodeSelection.create(view.state.doc, 4))
    view.dispatchEvent(event(DOWN))
    ist(view.state.selection.from, 6)
    setSel(view, NodeSelection.create(view.state.doc, 8))
    view.dispatchEvent(event(UP))
    ist(view.state.selection.from, 6)
  })

  it("updates the selection even if the DOM parameters look unchanged", () => {
    if (!document.hasFocus()) return
    let view = tempEditor({doc: doc(p("foobar<a>"))})
    view.focus()
    let decos = DecorationSet.create(view.state.doc, [Decoration.inline(1, 4, {color: "green"})])
    view.setProps({decorations() { return decos }})
    view.setProps({decorations: undefined})
    view.setProps({decorations() { return decos }})
    let range = document.createRange()
    range.setEnd(document.getSelection()!.anchorNode!, document.getSelection()!.anchorOffset)
    range.setStart(view.dom, 0)
    ist(range.toString(), "foobar")
  })

  it("sets selection even if Selection.extend throws DOMException", () => {
    let originalExtend = window.Selection.prototype.extend
    window.Selection.prototype.extend = () => {
      // declare global: DOMException
      throw new DOMException("failed")
    }
    try {
      let view = tempEditor({doc: doc(p("foo", img), hr(), p(img, "bar"))})
      setSel(view, NodeSelection.create(view.state.doc, 4))
      view.dispatchEvent(event(DOWN))
      ist(view.state.selection.from, 6)
    } finally {
      window.Selection.prototype.extend = originalExtend
    }
  })

  it("doesn't put the cursor after BR hack nodes", () => {
    if (!document.hasFocus()) return
    let view = tempEditor({doc: doc(p())})
    view.focus()
    ist(getSelection()!.focusOffset, 0)
  })
})
