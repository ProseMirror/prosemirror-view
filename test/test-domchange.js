const ist = require("ist")
const {eq, doc, p, pre, h1, a, em, img: img_, br, strong, blockquote} = require("prosemirror-test-builder")
const {EditorState, Plugin} = require("prosemirror-state")
const {tempEditor, findTextNode} = require("./view")

const img = img_({src: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="})

function setSel(aNode, aOff, fNode, fOff) {
  let r = document.createRange(), s = window.getSelection()
  r.setEnd(fNode || aNode, fNode ? fOff : aOff)
  r.setStart(aNode, aOff)
  s.removeAllRanges()
  s.addRange(r)
}

function flush(view) {
  view.domObserver.flush()
  if (view.inDOMChange) view.inDOMChange.finish()
}

function getStepPlugin(step) {
  return new Plugin({
    state: {
      init() {},
      apply(tr) {
        let { from, to } = tr.steps[0]
        step.from = from
        step.to = to
      }
    }
  })
}

describe("DOM change", () => {
  it("notices when text is added", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.dom, "hello").nodeValue = "heLllo"
    flush(view)
    ist(view.state.doc, doc(p("heLllo")), eq)
  })

  it("notices when text is removed", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.dom, "hello").nodeValue = "heo"
    flush(view)
    ist(view.state.doc, doc(p("heo")), eq)
  })

  it("handles ambiguous changes", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.dom, "hello").nodeValue = "helo"
    flush(view)
    ist(view.state.doc, doc(p("helo")), eq)
  })

  it("respects stored marks", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.em.create()))
    findTextNode(view.dom, "hello").nodeValue = "helloo"
    flush(view)
    ist(view.state.doc, doc(p("hello", em("o"))), eq)
  })

  it("can add a node", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    let txt = findTextNode(view.dom, "hello")
    txt.parentNode.appendChild(document.createTextNode("!"))
    flush(view)
    ist(view.state.doc, doc(p("hello!")), eq)
  })

  it("can remove a text node", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    let txt = findTextNode(view.dom, "hello")
    txt.parentNode.removeChild(txt)
    flush(view)
    ist(view.state.doc, doc(p()), eq)
  })

  it("can add a paragraph", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.dom.insertBefore(document.createElement("p"), view.dom.firstChild)
      .appendChild(document.createTextNode("hey"))
    flush(view)
    ist(view.state.doc, doc(p("hey"), p("hello")), eq)
  })

  it("supports duplicating a paragraph", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    view.dom.insertBefore(document.createElement("p"), view.dom.firstChild)
      .appendChild(document.createTextNode("hello"))
    flush(view)
    ist(view.state.doc, doc(p("hello"), p("hello")), eq)
  })

  it("support inserting repeated text", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.dom, "hello").nodeValue = "helhello"
    flush(view)
    ist(view.state.doc, doc(p("helhello")), eq)
  })

  it("detects an enter press", () => {
    let enterPressed = false
    let view = tempEditor({
      doc: doc(blockquote(p("foo"), p("<a>"))),
      handleKeyDown: (_view, event) => { if (event.keyCode == 13) return enterPressed = true }
    })
    let bq = view.dom.querySelector("blockquote")
    bq.appendChild(document.createElement("p"))
    flush(view)
    ist(enterPressed)
  })

  it("detects a simple backspace press", () => {
    let backspacePressed = false
    let view = tempEditor({
      doc: doc(p("foo"), p("<a>bar")),
      handleKeyDown: (_view, event) => { if (event.keyCode == 8) return backspacePressed = true }
    })
    view.dom.removeChild(view.dom.lastChild)
    view.dom.firstChild.textContent = "foobar"
    flush(view)
    ist(backspacePressed)
  })

  it("detects a complex backspace press", () => {
    let backspacePressed = false
    let view = tempEditor({
      doc: doc(blockquote(blockquote(p("foo")), p("<a>", br, "bar"))),
      handleKeyDown: (_view, event) => { if (event.keyCode == 8) return backspacePressed = true }
    })
    let bq = view.dom.firstChild
    bq.removeChild(bq.lastChild)
    bq.firstChild.firstChild.innerHTML = "foo<br>bar"
    flush(view)
    ist(backspacePressed)
  })

  it("doesn't confuse delete with backspace", () => {
    let backspacePressed = false
    let view = tempEditor({
      doc: doc(p("foo<a>"), p("bar")),
      handleKeyDown: (_view, event) => { if (event.keyCode == 8) return backspacePressed = true }
    })
    view.dom.removeChild(view.dom.lastChild)
    view.dom.firstChild.textContent = "foobar"
    flush(view)
    ist(!backspacePressed)
  })

  it("correctly adjusts the selection", () => {
    let view = tempEditor({doc: doc(p("abc<a>"))})
    let textNode = findTextNode(view.dom, "abc")
    textNode.nodeValue = "abcd"
    setSel(textNode, 3)
    flush(view)
    ist(view.state.doc, doc(p("abcd")), eq)
    ist(view.state.selection.anchor, 4)
    ist(view.state.selection.head, 4)
  })

  it("handles splitting of a textblock", () => {
    let view = tempEditor({doc: doc(h1("abc"), p("defg<a>"))})
    let para = view.dom.querySelector("p")
    let split = para.parentNode.appendChild(para.cloneNode())
    split.innerHTML = "fg"
    findTextNode(para, "defg").nodeValue = "dexy"
    setSel(split.firstChild, 1)
    flush(view)
    ist(view.state.doc, doc(h1("abc"), p("dexy"), p("fg")), eq)
    ist(view.state.selection.anchor, 13)
  })

  it("handles a deep split of nodes", () => {
    let view = tempEditor({doc: doc(blockquote(p("ab<a>cd")))})
    let quote = view.dom.querySelector("blockquote")
    let quote2 = view.dom.appendChild(quote.cloneNode(true))
    findTextNode(quote, "abcd").nodeValue = "abx"
    let text2 = findTextNode(quote2, "abcd")
    text2.nodeValue = "cd"
    setSel(text2.parentNode, 0)
    flush(view)
    ist(view.state.doc, doc(blockquote(p("abx")), blockquote(p("cd"))), eq)
    ist(view.state.selection.anchor, 9)
  })

  it("can delete the third instance of a character", () => {
    let view = tempEditor({doc: doc(p("foo xxx<a> bar"))})
    findTextNode(view.dom, "foo xxx bar").nodeValue = "foo xx bar"
    flush(view)
    ist(view.state.doc, doc(p("foo xx bar")), eq)
  })

  it("can read a simple composition", () => {
    let view = tempEditor({doc: doc(p("hello"))})
    findTextNode(view.dom, "hello").nodeValue = "hellox"
    flush(view)
    ist(view.state.doc, doc(p("hellox")), eq)
  })

  it("can delete text in markup", () => {
    let view = tempEditor({doc: doc(p("a", em("b", img, strong("cd<a>")), "e"))})
    findTextNode(view.dom, "cd").nodeValue = "c"
    flush(view)
    ist(view.state.doc, doc(p("a", em("b", img, strong("c")), "e")), eq)
  })

  it("recognizes typing inside markup", () => {
    let view = tempEditor({doc: doc(p("a", em("b", img, strong("cd<a>")), "e"))})
    findTextNode(view.dom, "cd").nodeValue = "cdxy"
    flush(view)
    ist(view.state.doc, doc(p("a", em("b", img, strong("cdxy")), "e")), eq)
  })

  it("resolves ambiguous text input", () => {
    let view = tempEditor({doc: doc(p("fo<a>o"))})
    view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong.create()))
    findTextNode(view.dom, "\ufeff").nodeValue = "\ufeffo"
    flush(view)
    ist(view.state.doc, doc(p("fo", strong("o"), "o")), eq)
  })

  it("does not repaint a text node when it's typed into", () => {
    let view = tempEditor({doc: doc(p("fo<a>o"))})
    findTextNode(view.dom, "foo").nodeValue = "fojo"
    let mutated = false, observer = new MutationObserver(() => mutated = true)
    observer.observe(view.dom, {subtree: true, characterData: true, childList: true})
    flush(view)
    ist(view.state.doc, doc(p("fojo")), eq)
    ist(!mutated)
    observer.disconnect()
  })

  it("understands text typed into an empty paragraph", () => {
    let view = tempEditor({doc: doc(p("<a>"))})
    view.dom.querySelector("p").textContent = "i"
    flush(view)
    ist(view.state.doc, doc(p("i")), eq)
  })

  it("doesn't treat a placeholder BR as real content", () => {
    let view = tempEditor({doc: doc(p("i<a>"))})
    view.dom.querySelector("p").innerHTML = "<br>"
    flush(view)
    ist(view.state.doc, doc(p()), eq)
  })

  it("fixes text changes when input is ignored", () => {
    let view = tempEditor({doc: doc(p("foo")), dispatchTransaction: () => null})
    findTextNode(view.dom, "foo").nodeValue = "food"
    flush(view)
    ist(view.dom.textContent, "foo")
  })

  it("fixes structure changes when input is ignored", () => {
    let view = tempEditor({doc: doc(p("foo", br, "bar")), dispatchTransaction: () => null})
    let para = view.dom.querySelector("p")
    para.replaceChild(document.createElement("img"), para.lastChild)
    flush(view)
    ist(view.dom.textContent, "foobar")
  })

  it("maps through concurrent changes", () => {
    let view = tempEditor({doc: doc(p("one two three"))})
    findTextNode(view.dom, "one two three").nodeValue = "one two THREE"
    view.dispatchEvent({type: "input"})
    view.dispatch(view.state.tr.insertText("ONE AND A HALF", 1, 4))
    flush(view)
    ist(view.dom.textContent, "ONE AND A HALF two THREE")
    ist(view.state.doc, doc(p("ONE AND A HALF two THREE")), eq)
  })

  it("aborts when an incompatible state is set", () => {
    let view = tempEditor({doc: doc(p("abcde"))})
    findTextNode(view.dom, "abcde").nodeValue = "xabcde"
    view.dispatchEvent({type: "input"})
    view.updateState(EditorState.create({doc: doc(p("uvw"))}))
    flush(view)
    ist(view.state.doc, doc(p("uvw")), eq)
  })

  it("recognizes a mark change as such", () => {
    let view = tempEditor({doc: doc(p("one"))})
    view.dom.querySelector("p").innerHTML = "<b>one</b>"
    view.dispatchEvent({type: "input"})
    view.dispatch(view.state.tr.insertText("X", 2, 2))
    flush(view)
    ist(view.state.doc, doc(p(strong("oXne"))), eq)
  })

  it("preserves marks on deletion", () => {
    let view = tempEditor({doc: doc(p("one", em("x<a>")))})
    view.dom.querySelector("em").innerText = ""
    view.dispatchEvent({type: "input"})
    flush(view)
    view.dispatch(view.state.tr.insertText("y"))
    ist(view.state.doc, doc(p("one", em("y"))), eq)
  })

  it("works when a node's contentDOM is deleted", () => {
    let view = tempEditor({doc: doc(p("one"), pre("two<a>"))})
    view.dom.querySelector("pre").innerText = ""
    view.dispatchEvent({type: "input"})
    flush(view)
    ist(view.state.doc, doc(p("one"), pre()), eq)
    ist(view.state.selection.head, 6)
  })

  it("doesn't redraw content with marks when typing in front", () => {
    let view = tempEditor({doc: doc(p("foo", em("bar"), strong("baz")))})
    let bar = findTextNode(view.dom, "bar"), foo = findTextNode(view.dom, "foo")
    foo.nodeValue = "froo"
    flush(view)
    ist(view.state.doc, doc(p("froo", em("bar"), strong("baz"))), eq)
    ist(bar.parentNode && view.dom.contains(bar.parentNode))
    ist(foo.parentNode && view.dom.contains(foo.parentNode))
  })

  it("doesn't redraw content with marks when typing inside mark", () => {
    let view = tempEditor({doc: doc(p("foo", em("bar"), strong("baz")))})
    let bar = findTextNode(view.dom, "bar"), foo = findTextNode(view.dom, "foo")
    bar.nodeValue = "baar"
    flush(view)
    ist(view.state.doc, doc(p("foo", em("baar"), strong("baz"))), eq)
    ist(bar.parentNode && view.dom.contains(bar.parentNode))
    ist(foo.parentNode && view.dom.contains(foo.parentNode))
  })

  it("maps input to coordsAtPos through pending changes", () => {
    let view = tempEditor({doc: doc(p("foo"))})
    view.dispatchEvent({type: "input"})
    view.dispatch(view.state.tr.insertText("more text"))
    ist(view.coordsAtPos(13))
  })

  it("notices text added to a cursor wrapper at the start of a mark", () => {
    let view = tempEditor({doc: doc(p(strong(a("foo<a>"), "bar")))})
    findTextNode(view.dom, "\ufeff").nodeValue = "\ufeffxy"
    flush(view)
    ist(view.state.doc, doc(p(strong(a("foo"), "xybar"))), eq)
  })

  it("removes cursor wrapper text when the wrapper otherwise remains valid", () => {
    let view = tempEditor({doc: doc(p(a(strong("foo<a>"), "bar")))})
    findTextNode(view.dom, "\ufeff").nodeValue = "\ufeffq"
    flush(view)
    ist(view.state.doc, doc(p(a(strong("fooq"), "bar"))), eq)
    ist(!findTextNode(view.dom, "\ufeffq"))
  })

  it("doesn't confuse delete with backspace around same character with hint", () => {
    let step = {}
    let view = tempEditor({
      doc: doc(p("a<a>a")),
      plugins: [getStepPlugin(step)]
    })

    view.lastKeyCode = 8
    view.lastKeyCodeTime = Date.now()
    findTextNode(view.dom, "aa").nodeValue = "a"
    flush(view)
    ist(view.state.doc, doc(p("a")), eq)
    ist(step.from, 1)
    ist(step.to, 2)
  })

  it("does confuse delete with backspace around same character", () => {
    let step = {}
    let view = tempEditor({
      doc: doc(p("a<a>a")),
      plugins: [getStepPlugin(step)]
    })

    view.lastKeyCode = 0
    view.lastKeyCodeTime = Date.now()
    findTextNode(view.dom, "aa").nodeValue = "a"
    flush(view)
    ist(view.state.doc, doc(p("a")), eq)
    ist(step.from, 2)
    ist(step.to, 3)
  })

  it("does confuse delete with backspace around same character after some time", () => {
    let step = {}
    let view = tempEditor({
      doc: doc(p("a<a>a")),
      plugins: [getStepPlugin(step)]
    })

    view.lastKeyCode = 8
    view.lastKeyCodeTime = Date.now() - 150
    findTextNode(view.dom, "aa").nodeValue = "a"
    flush(view)
    ist(view.state.doc, doc(p("a")), eq)
    ist(step.from, 2)
    ist(step.to, 3)
  })
})
