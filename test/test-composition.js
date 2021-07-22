const {schema, eq, doc, p, em, code, strong} = require("prosemirror-test-builder")
const ist = require("ist")
const {tempEditor, requireFocus, findTextNode} = require("./view")
const {Decoration, DecorationSet, __endComposition} = require("..")
const {Plugin} = require("prosemirror-state")

// declare global: CompositionEvent

function event(pm, type) {
  pm.dom.dispatchEvent(new CompositionEvent(type))
}

function edit(node, text = "", from = node.nodeValue.length, to = from) {
  let val = node.nodeValue
  node.nodeValue = val.slice(0, from) + text + val.slice(to)
  document.getSelection().collapse(node, from + text.length)
  return node
}

function hasCompositionNode(_pm) {
  let {focusNode} = document.getSelection()
  while (focusNode && !focusNode.pmViewDesc) focusNode = focusNode.parentNode
  return focusNode && focusNode.pmViewDesc.constructor.name == "CompositionViewDesc"
}

function compose(pm, start, update, options = {}) {
  event(pm, "compositionstart")
  ist(pm.composing)
  let node, sel = document.getSelection()
  for (let i = -1; i < update.length; i++) {
    if (i < 0) node = start()
    else update[i](node)
    let {focusNode, focusOffset} = sel
    pm.domObserver.flush()

    if (options.cancel && i == update.length - 1) {
      ist(!hasCompositionNode(pm))
    } else {
      ist(node.parentNode && pm.dom.contains(node.parentNode))
      ist(sel.focusNode, focusNode)
      ist(sel.focusOffset, focusOffset)
      if (options.node) ist(hasCompositionNode(pm))
    }
  }
  event(pm, "compositionend")
  if (options.end) {
    options.end(node)
    pm.domObserver.flush()
  }
  __endComposition(pm)
  ist(!pm.composing)
  ist(!hasCompositionNode(pm))
}

function wordDeco(state) {
  let re = /\w+/g, deco = []
  state.doc.descendants((node, pos) => {
    if (node.isText) for (let m; m = re.exec(node.text);)
      deco.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {class: "word"}))
  })
  return DecorationSet.create(state.doc, deco)
}

const wordHighlighter = new Plugin({
  props: {decorations: wordDeco}
})

function widgets(positions, sides) {
  return new Plugin({
    state: {
      init(state) {
        let deco = positions.map((p, i) => Decoration.widget(p, () => {
          let s = document.createElement("var")
          s.textContent = "×"
          return s
        }, {side: sides[i]}))
        return DecorationSet.create(state.doc, deco)
      },
      apply(tr, deco) {
        return deco.map(tr.mapping, tr.doc)
      }
    },
    props: {
      decorations(state) { return this.getState(state) }
    }
  })
}

describe("EditorView composition", () => {
  it("supports composition in an empty block", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("<a>"))}))
    compose(pm, () => edit(pm.dom.firstChild.appendChild(document.createTextNode("a"))), [
      n => edit(n, "b"),
      n => edit(n, "c")
    ], {node: true})
    ist(pm.state.doc, doc(p("abc")), eq)
  })

  it("supports composition at end of block", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("foo"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "foo")), [
      n => edit(n, "!"),
      n => edit(n, "?")
    ])
    ist(pm.state.doc, doc(p("foo!?")), eq)
  })

  it("supports composition at end of block in a new node", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("foo"))}))
    compose(pm, () => edit(pm.dom.firstChild.appendChild(document.createTextNode("!"))), [
      n => edit(n, "?")
    ], {node: true})
    ist(pm.state.doc, doc(p("foo!?")), eq)
  })

  it("supports composition at start of block in a new node", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("foo"))}))
    compose(pm, () => {
      let p = pm.dom.firstChild
      return edit(p.insertBefore(document.createTextNode("!"), p.firstChild))
    }, [
      n => edit(n, "?")
    ], {node: true})
    ist(pm.state.doc, doc(p("!?foo")), eq)
  })

  it("supports composition inside existing text", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("foo"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "foo")), [
      n => edit(n, "x", 1),
      n => edit(n, "y", 2),
      n => edit(n, "z", 3)
    ])
    ist(pm.state.doc, doc(p("fxyzoo")), eq)
  })

  it("can deal with Android-style newline-after-composition", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("abcdef"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "abcdef")), [
      n => edit(n, "x", 3),
      n => edit(n, "y", 4)
    ], {end: n => {
      let line = pm.dom.appendChild(document.createElement("div"))
      line.textContent = "def"
      n.nodeValue = "abcxy"
      document.getSelection().collapse(line, 0)
    }})
    ist(pm.state.doc, doc(p("abcxy"), p("def")), eq)
  })

  it("handles replacement of existing words", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one two three"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "one two three"), "five", 4, 7), [
      n => edit(n, "seven", 4, 8),
      n => edit(n, "zero", 4, 9)
    ])
    ist(pm.state.doc, doc(p("one zero three")), eq)
  })

  it("handles composition inside marks", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one ", em("two")))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "o"), [
      n => edit(n, "o"),
      n => edit(n, "w")
    ])
    ist(pm.state.doc, doc(p("one ", em("twooow"))), eq)
  })

  it("handles composition in a mark that has multiple children", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one ", em("two", strong(" three"))))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "o"), [
      n => edit(n, "o"),
      n => edit(n, "w")
    ])
    ist(pm.state.doc, doc(p("one ", em("twooow", strong(" three")))), eq)
  })

  it("supports composition in a cursor wrapper", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("<a>"))}))
    pm.dispatch(pm.state.tr.addStoredMark(schema.marks.em.create()))
    compose(pm, () => edit(pm.dom.firstChild.appendChild(document.createTextNode("")), "a"), [
      n => edit(n, "b"),
      n => edit(n, "c")
    ], {node: true})
    ist(pm.state.doc, doc(p(em("abc"))), eq)
  })

  it("handles composition in a multi-child mark with a cursor wrapper", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one ", em("two<a>", strong(" three"))))}))
    pm.dispatch(pm.state.tr.addStoredMark(schema.marks.code.create()))
    let emNode = pm.dom.querySelector("em")
    compose(pm, () => edit(emNode.insertBefore(document.createTextNode(""), emNode.querySelector("strong")), "o"), [
      n => edit(n, "o"),
      n => edit(n, "w")
    ], {node: true})
    ist(pm.state.doc, doc(p("one ", em("two", code("oow"), strong(" three")))), eq)
  })

  it("doesn't get interrupted by changes in decorations", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("foo ...")), plugins: [wordHighlighter]}))
    compose(pm, () => edit(findTextNode(pm.dom, " ...")), [
      n => edit(n, "hi", 1, 4)
    ])
    ist(pm.state.doc, doc(p("foo hi")), eq)
  })

  it("works inside highlighted text", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one two")), plugins: [wordHighlighter]}))
    compose(pm, () => edit(findTextNode(pm.dom, "one"), "x"), [
      n => edit(n, "y"),
      n => edit(n, ".")
    ])
    ist(pm.state.doc, doc(p("onexy. two")), eq)
  })

  it("can handle compositions spanning multiple nodes", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one two")), plugins: [wordHighlighter]}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "a"), [
      n => edit(n, "b"),
      n => edit(n, "c")
    ], {end: n => {
      n.parentNode.previousSibling.remove()
      n.parentNode.previousSibling.remove()
      return edit(n, "xyzone ", 0)
    }})
    ist(pm.state.doc, doc(p("xyzone twoabc")), eq)
  })

  it("doesn't overwrite widgets next to the composition", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("")), plugins: [widgets([1, 1], [-1, 1])]}))
    compose(pm, () => {
      let p = pm.dom.firstChild
      return edit(p.insertBefore(document.createTextNode("a"), p.lastChild))
    }, [n => edit(n, "b", 0, 1)], {end: () => {
      ist(pm.dom.querySelectorAll("var").length, 2)
    }})
    ist(pm.state.doc, doc(p("b")), eq)
  })

  it("cancels composition when a change fully overlaps with it", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one"), p("two"), p("three"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "x"), [
      () => pm.dispatch(pm.state.tr.insertText("---", 3, 13))
    ], {cancel: true})
    ist(pm.state.doc, doc(p("on---hree")), eq)
  })

  it("cancels composition when a change partially overlaps with it", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one"), p("two"), p("three"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "x", 0), [
      () => pm.dispatch(pm.state.tr.insertText("---", 7, 15))
    ], {cancel: true})
    ist(pm.state.doc, doc(p("one"), p("x---ee")), eq)
  })

  it("cancels composition when a change happens inside of it", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one"), p("two"), p("three"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "x", 0), [
      () => pm.dispatch(pm.state.tr.insertText("!", 7, 8))
    ], {cancel: true})
    ist(pm.state.doc, doc(p("one"), p("x!wo"), p("three")), eq)
  })

  it("doesn't cancel composition when a change happens elsewhere", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one"), p("two"), p("three"))}))
    compose(pm, () => edit(findTextNode(pm.dom, "two"), "x", 0), [
      n => edit(n, "y", 1),
      () => pm.dispatch(pm.state.tr.insertText("!", 2, 3)),
      n => edit(n, "z", 2)
    ])
    ist(pm.state.doc, doc(p("o!e"), p("xyztwo"), p("three")), eq)
  })

  it("handles compositions rapidly following each other", () => {
    let pm = requireFocus(tempEditor({doc: doc(p("one"), p("two"))}))
    event(pm, "compositionstart")
    let one = findTextNode(pm.dom, "one")
    edit(one, "!")
    pm.domObserver.flush()
    event(pm, "compositionend")
    one.nodeValue = "one!!"
    let L2 = pm.dom.lastChild
    event(pm, "compositionstart")
    let two = findTextNode(pm.dom, "two")
    ist(pm.dom.lastChild, L2)
    edit(two, ".")
    window.two = two
    pm.domObserver.flush()
    ist(document.getSelection().focusNode, two)
    ist(document.getSelection().focusOffset, 4)
    ist(pm.composing)
    event(pm, "compositionend")
    pm.domObserver.flush()
    ist(pm.state.doc, doc(p("one!!"), p("two.")), eq)
  })

  function crossParagraph(first) {
    let pm = requireFocus(tempEditor({doc: doc(p("one <a>two"), p("three"), p("four<b> five"))}))
    compose(pm, () => {
      for (let i = 0; i < 2; i++) pm.dom.removeChild(first ? pm.dom.lastChild : pm.dom.firstChild)
      let target = pm.dom.firstChild.firstChild
      target.nodeValue = "one A five"
      document.getSelection().collapse(target, 4)
      return target
    }, [
      n => edit(n, "B", 4, 5),
      n => edit(n, "C", 4, 5)
    ])
    ist(pm.state.doc, doc(p("one C five")), eq)
  }

  it("can handle cross-paragraph compositions", () => crossParagraph(true))

  it("can handle cross-paragraph compositions (keeping the last paragraph)", () => crossParagraph(false))
})
