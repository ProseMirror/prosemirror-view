const ist = require("ist")
const {eq, doc, p, h1, em, img, strong, blockquote} = require("prosemirror-model/test/build")
const {readInputChange, readCompositionChange} = require("../src/domchange")
const {tempEditor, findTextNode} = require("./view")

function setSel(aNode, aOff, fNode, fOff) {
  let r = document.createRange(), s = window.getSelection()
  r.setEnd(fNode || aNode, fNode ? fOff : aOff)
  r.setStart(aNode, aOff)
  s.removeAllRanges()
  s.addRange(r)
}

describe("readInputChange", () => {
  it("notices when text is added", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.content, "hello").nodeValue = "heLllo"
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("heLllo")), eq)
  })

  it("notices when text is removed", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.content, "hello").nodeValue = "heo"
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("heo")), eq)
  })

  it("handles ambiguous changes", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.content, "hello").nodeValue = "helo"
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("helo")), eq)
  })

  it("respects stored marks", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.props.onAction({type: "addStoredMark", mark: view.state.schema.marks.em.create()})
    findTextNode(view.content, "hello").nodeValue = "helloo"
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("hello", em("o"))), eq)
  })

  it("can add a node", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    let txt = findTextNode(view.content, "hello")
    txt.parentNode.appendChild(document.createTextNode("!"))
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("hello!")), eq)
  })

  it("can remove a text node", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    let txt = findTextNode(view.content, "hello")
    txt.parentNode.removeChild(txt)
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p()), eq)
  })

  it("can add a paragraph", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.content.insertBefore(document.createElement("p"), view.content.firstChild)
      .appendChild(document.createTextNode("hey"))
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("hey"), p("hello")), eq)
  })

  it("supports duplicating a paragraph", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.content.insertBefore(document.createElement("p"), view.content.firstChild)
      .appendChild(document.createTextNode("hello"))
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("hello"), p("hello")), eq)
  })

  it("support inserting repeated text", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.content, "hello").nodeValue = "helhello"
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("helhello")), eq)
  })

  it("detects an enter press", () => {
    let enterPressed = false
    let view = tempEditor({
      doc: doc(blockquote(p("foo"), p("<a>"))),
      handleKeyDown: (_view, event) => { if (event.keyCode == 13) return enterPressed = true }
    })
    let bq = view.content.querySelector("blockquote")
    bq.appendChild(document.createElement("p"))
    readInputChange(view, view.state)
    ist(enterPressed)
  })

  it("correctly adjusts the selection", () => {
    let view = tempEditor({doc: doc(p("abc<a>"))})
    let textNode = findTextNode(view.content, "abc")
    textNode.nodeValue = "abcd"
    setSel(textNode, 3)
    readInputChange(view, view.state)
    ist(view.state.doc, doc(p("abcd")), eq)
    ist(view.state.selection.anchor, 4)
    ist(view.state.selection.head, 4)
  })

  it("handles splitting of a textblock", () => {
    let view = tempEditor({doc: doc(h1("abc"), p("defg<a>"))})
    let para = view.content.querySelector("p")
    let split = para.parentNode.appendChild(para.cloneNode())
    split.innerHTML = "fg"
    findTextNode(para, "defg").nodeValue = "dexy"
    setSel(split.firstChild, 1)
    readInputChange(view, view.state)
    ist(view.state.doc, doc(h1("abc"), p("dexy"), p("fg")), eq)
    ist(view.state.selection.anchor, 13)
  })

  it("handles a deep split of nodes", () => {
    let view = tempEditor({doc: doc(blockquote(p("ab<a>cd")))})
    let quote = view.content.querySelector("blockquote")
    let quote2 = view.content.appendChild(quote.cloneNode(true))
    findTextNode(quote, "abcd").nodeValue = "abx"
    let text2 = findTextNode(quote2, "abcd")
    text2.nodeValue = "cd"
    setSel(text2.parentNode, 0)
    readInputChange(view, view.state)
    ist(view.state.doc, doc(blockquote(p("abx")), blockquote(p("cd"))), eq)
    ist(view.state.selection.anchor, 9)
  })
})

describe("readCompositionChange", () => {
  it("can read a simple composition", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.content, "hello").nodeValue = "hellox"
    readCompositionChange(view, view.state, 0)
    ist(view.state.doc, doc(p("hellox")), eq)
  })

  it("can delete text in markup", () => {
    let view = tempEditor({doc: doc(p("a", em("b", img, strong("cd<a>")), "e"))})
    findTextNode(view.content, "cd").nodeValue = "c"
    readCompositionChange(view, view.state, 0)
    ist(view.state.doc, doc(p("a", em("b", img, strong("c")), "e")), eq)
  })

  it("recognizes typing inside markup", () => {
    let view = tempEditor({doc: doc(p("a", em("b", img, strong("cd<a>")), "e"))})
    findTextNode(view.content, "cd").nodeValue = "cdxy"
    readCompositionChange(view, view.state, 0)
    ist(view.state.doc, doc(p("a", em("b", img, strong("cdxy")), "e")), eq)
  })

  it("resolves ambiguous text input", () => {
    let view = tempEditor({doc: doc(p("fo<a>o"))})
    view.props.onAction({type: "addStoredMark", mark: view.state.schema.marks.strong.create()})
    findTextNode(view.content, "foo").nodeValue = "fooo"
    readCompositionChange(view, view.state, 0)
    ist(view.state.doc, doc(p("fo", strong("o"), "o")), eq)
  })
})
