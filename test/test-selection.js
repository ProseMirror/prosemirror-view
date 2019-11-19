const {doc, blockquote, p, em, img: img_, strong, code, br, hr, ul, li} = require("prosemirror-test-builder")
const ist = require("ist")
const {Selection, NodeSelection} = require("prosemirror-state")
const {tempEditor, findTextNode} = require("./view")
const {Decoration, DecorationSet} = require("..")

const img = img_({src: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="})

function allPositions(doc) {
  let found = []
  function scan(node, start) {
    if (node.isTextblock) {
      for (let i = 0; i <= node.content.size; i++) found.push(start + i)
    } else {
      node.forEach((child, offset) => scan(child, start + offset + 1))
    }
  }
  scan(doc, 0)
  return found
}

function setDOMSel(node, offset) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  let sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

function getSel() {
  let sel = window.getSelection()
  let node = sel.focusNode, offset = sel.focusOffset
  while (node && node.nodeType != 3) {
    let after = offset < node.childNodes.length && node.childNodes[offset]
    let before = offset > 0 && node.childNodes[offset - 1]
    if (after) { node = after; offset = 0 }
    else if (before) { node = before; offset = node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length }
    else break
  }
  return {node: node, offset: offset}
}

function setSel(view, sel) {
  if (typeof sel == "number") sel = Selection.near(view.state.doc.resolve(sel))
  view.dispatch(view.state.tr.setSelection(sel))
}

function event(code) {
  let event = document.createEvent("Event")
  event.initEvent("keydown", true, true)
  event.keyCode = code
  return event
}
const LEFT = 37, RIGHT = 39, UP = 38, DOWN = 40

if (!document.hasFocus()) console["warn"]("Document doesn't have focus. Skipping some tests.")

describe("EditorView", () => {
  it("can read the DOM selection", () => {
    // disabled when the document doesn't have focus, since that causes this to fail
    if (!document.hasFocus()) return

    let view = tempEditor({doc: doc(p("one"), hr, blockquote(p("two")))})
    function test(node, offset, expected) {
      setDOMSel(node, offset)
      view.dom.focus()
      view.domObserver.flush()
      let sel = view.state.selection
      ist(sel.head == null ? sel.from : sel.head, expected)
    }
    let one = findTextNode(view.dom, "one")
    let two = findTextNode(view.dom, "two")
    test(one, 0, 1)
    test(one, 1, 2)
    test(one, 3, 4)
    test(one.parentNode, 0, 1)
    test(one.parentNode, 1, 4)
    test(two, 0, 8)
    test(two, 3, 11)
    test(two.parentNode, 1, 11)
    test(view.dom, 1, 4)
    test(view.dom, 2, 8)
    test(view.dom, 3, 11)
  })

  it("syncs the DOM selection with the editor selection", () => {
    // disabled when the document doesn't have focus, since that causes this to fail
    if (!document.hasFocus()) return

    let view = tempEditor({doc: doc(p("one"), hr, blockquote(p("two")))})
    function test(pos, node, offset) {
      setSel(view, pos)
      let sel = getSel()
      ist(sel.node, node)
      ist(sel.offset, offset)
    }
    let one = findTextNode(view.dom, "one")
    let two = findTextNode(view.dom, "two")
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

  it("produces sensible screen coordinates in corner cases", () => {
    let view = tempEditor({doc: doc(p("one", em("two", strong("three"), img), br, code("foo")), p())})
    return new Promise(ok => {
      setTimeout(() => {
        allPositions(view.state.doc).forEach(pos => {
          let coords = view.coordsAtPos(pos)
          let found = view.posAtCoords({top: coords.top + 1, left: coords.left}).pos
          ist(found, pos)
          setSel(view, pos)
        })
        ok()
      }, 20)
    })
  })

  it("produces horizontal rectangles for positions between blocks", () => {
    let view = tempEditor({doc: doc(p("ha"), hr, blockquote(p("ba")))})
    let a = view.coordsAtPos(0)
    ist(a.top, a.bottom)
    ist(a.top, view.dom.firstChild.getBoundingClientRect().top)
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
    view.dom.style.width = "4em"
    allPositions(view.state.doc);[9].forEach(pos => {
      let coords = view.coordsAtPos(pos)
      let found = view.posAtCoords({top: coords.top + 1, left: coords.left}).pos
      ist(found, pos)
    })
  })

  it("can go back and forth between screen coords and document positions", () => {
    let view = tempEditor({doc: doc(p("one"), blockquote(p("two"), p("three")))})
    ;[1, 2, 4, 7, 14, 15].forEach(pos => {
      let coords = view.coordsAtPos(pos)
      let found = view.posAtCoords({top: coords.top + 1, left: coords.left}).pos
      ist(found, pos)
    })
  })

  it("returns correct screen coordinates for wrapped lines", () => {
    let view = tempEditor({})
    let top = view.coordsAtPos(1), pos = 1, end
    for (let i = 0; i < 100; i++) {
      view.dispatch(view.state.tr.insertText("abc def ghi "))
      pos += 12
      end = view.coordsAtPos(pos)
      if (end.bottom > top.bottom + 4) break
    }
    ist(view.posAtCoords({left: end.left + 50, top: end.top + 5}).pos, pos)
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
    let view = tempEditor({doc: doc(p("hello<a>"), hr, ul(li(p("there"))))})
    view.dispatchEvent(event(DOWN))
    ist(view.state.selection.from, 7)
    setSel(view, 11)
    view.dispatchEvent(event(UP))
    ist(view.state.selection.from, 7)
  })

  it("supports arrow motion through adjacent blocks", () => {
    let view = tempEditor({doc: doc(blockquote(p("hello<a>")), hr, hr, p("there"))})
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
    let view = tempEditor({doc: doc(p("foo<a>"), hr, hr, p("bar"))})
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
    let view = tempEditor({doc: doc(p("foo", img), hr, p(img, "bar"))})
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
    view.setProps({decorations: null})
    view.setProps({decorations() { return decos }})
    let range = document.createRange()
    range.setEnd(document.getSelection().anchorNode, document.getSelection().anchorOffset)
    range.setStart(view.dom, 0)
    ist(range.toString(), "foobar")
  })
})
