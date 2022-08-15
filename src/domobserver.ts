import {Selection} from "prosemirror-state"
import * as browser from "./browser"
import {domIndex, isEquivalentPosition, selectionCollapsed, DOMSelection} from "./dom"
import {hasFocusAndSelection, selectionToDOM, selectionFromDOM} from "./selection"
import {EditorView} from "./index"

const observeOptions = {
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  attributes: true,
  attributeOldValue: true,
  subtree: true
}
// IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
const useCharData = browser.ie && browser.ie_version <= 11

class SelectionState {
  anchorNode: Node | null = null
  anchorOffset: number = 0
  focusNode: Node | null = null
  focusOffset: number = 0

  set(sel: DOMSelection) {
    this.anchorNode = sel.anchorNode; this.anchorOffset = sel.anchorOffset
    this.focusNode = sel.focusNode; this.focusOffset = sel.focusOffset
  }

  clear() {
    this.anchorNode = this.focusNode = null
  }

  eq(sel: DOMSelection) {
    return sel.anchorNode == this.anchorNode && sel.anchorOffset == this.anchorOffset &&
      sel.focusNode == this.focusNode && sel.focusOffset == this.focusOffset
  }
}

export class DOMObserver {
  queue: MutationRecord[] = []
  flushingSoon = -1
  observer: MutationObserver | null = null
  currentSelection = new SelectionState
  onCharData: ((e: Event) => void) | null = null
  suppressingSelectionUpdates = false

  constructor(
    readonly view: EditorView,
    readonly handleDOMChange: (from: number, to: number, typeOver: boolean, added: Node[]) => void
  ) {
    this.observer = window.MutationObserver &&
      new window.MutationObserver(mutations => {
        for (let i = 0; i < mutations.length; i++) this.queue.push(mutations[i])
        // IE11 will sometimes (on backspacing out a single character
        // text node after a BR node) call the observer callback
        // before actually updating the DOM, which will cause
        // ProseMirror to miss the change (see #930)
        if (browser.ie && browser.ie_version <= 11 && mutations.some(
          m => m.type == "childList" && m.removedNodes.length ||
               m.type == "characterData" && m.oldValue!.length > m.target.nodeValue!.length))
          this.flushSoon()
        else
          this.flush()
      })
    if (useCharData) {
      this.onCharData = e => {
        this.queue.push({target: e.target as Node, type: "characterData", oldValue: (e as any).prevValue} as MutationRecord)
        this.flushSoon()
      }
    }
    this.onSelectionChange = this.onSelectionChange.bind(this)
  }

  flushSoon() {
    if (this.flushingSoon < 0)
      this.flushingSoon = window.setTimeout(() => { this.flushingSoon = -1; this.flush() }, 20)
  }

  forceFlush() {
    if (this.flushingSoon > -1) {
      window.clearTimeout(this.flushingSoon)
      this.flushingSoon = -1
      this.flush()
    }
  }

  start() {
    if (this.observer) {
      this.observer.takeRecords()
      this.observer.observe(this.view.dom, observeOptions)
    }
    if (this.onCharData)
      this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.connectSelection()
  }

  stop() {
    if (this.observer) {
      let take = this.observer.takeRecords()
      if (take.length) {
        for (let i = 0; i < take.length; i++) this.queue.push(take[i])
        window.setTimeout(() => this.flush(), 20)
      }
      this.observer.disconnect()
    }
    if (this.onCharData) this.view.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
    this.disconnectSelection()
  }

  connectSelection() {
    this.view.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange)
  }

  disconnectSelection() {
    this.view.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange)
  }

  suppressSelectionUpdates() {
    this.suppressingSelectionUpdates = true
    setTimeout(() => this.suppressingSelectionUpdates = false, 50)
  }

  onSelectionChange() {
    if (!hasFocusAndSelection(this.view)) return
    if (this.suppressingSelectionUpdates) return selectionToDOM(this.view)
    // Deletions on IE11 fire their events in the wrong order, giving
    // us a selection change event before the DOM changes are
    // reported.
    if (browser.ie && browser.ie_version <= 11 && !this.view.state.selection.empty) {
      let sel = this.view.domSelection()
      // Selection.isCollapsed isn't reliable on IE
      if (sel.focusNode && isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode!, sel.anchorOffset))
        return this.flushSoon()
    }
    this.flush()
  }

  setCurSelection() {
    this.currentSelection.set(this.view.domSelection())
  }

  ignoreSelectionChange(sel: DOMSelection) {
    if (sel.rangeCount == 0) return true
    let container = sel.getRangeAt(0).commonAncestorContainer
    let desc = this.view.docView.nearestDesc(container)
    if (desc && desc.ignoreMutation({
      type: "selection",
      target: container.nodeType == 3 ? container.parentNode : container
    } as any)) {
      this.setCurSelection()
      return true
    }
  }

  flush() {
    let {view} = this
    if (!view.docView || this.flushingSoon > -1) return
    let mutations = this.observer ? this.observer.takeRecords() : []
    if (this.queue.length) {
      mutations = this.queue.concat(mutations)
      this.queue.length = 0
    }

    let sel = view.domSelection()
    let newSel = !this.suppressingSelectionUpdates && !this.currentSelection.eq(sel) && hasFocusAndSelection(view) && !this.ignoreSelectionChange(sel)

    let from = -1, to = -1, typeOver = false, added: Node[] = []
    if (view.editable) {
      for (let i = 0; i < mutations.length; i++) {
        let result = this.registerMutation(mutations[i], added)
        if (result) {
          from = from < 0 ? result.from : Math.min(result.from, from)
          to = to < 0 ? result.to : Math.max(result.to, to)
          if (result.typeOver) typeOver = true
        }
      }
    }

    if (browser.gecko && added.length > 1) {
      let brs = added.filter(n => n.nodeName == "BR")
      if (brs.length == 2) {
        let a = brs[0] as HTMLElement, b = brs[1] as HTMLElement
        if (a.parentNode && a.parentNode.parentNode == b.parentNode) b.remove()
        else a.remove()
      }
    }

    let readSel: Selection | null = null
    // If it looks like the browser has reset the selection to the
    // start of the document after focus, restore the selection from
    // the state
    if (from < 0 && newSel && view.input.lastFocus > Date.now() - 200 &&
        view.input.lastTouch < Date.now() - 300 &&
        selectionCollapsed(sel) && (readSel = selectionFromDOM(view)) &&
        readSel.eq(Selection.near(view.state.doc.resolve(0), 1))) {
      view.input.lastFocus = 0
      selectionToDOM(view)
      this.currentSelection.set(sel)
      view.scrollToSelection()
    } else if (from > -1 || newSel) {
      if (from > -1) {
        view.docView.markDirty(from, to)
        checkCSS(view)
      }
      this.handleDOMChange(from, to, typeOver, added)
      if (view.docView && view.docView.dirty) view.updateState(view.state)
      else if (!this.currentSelection.eq(sel)) selectionToDOM(view)
      this.currentSelection.set(sel)
    }
  }

  registerMutation(mut: MutationRecord, added: Node[]) {
    // Ignore mutations inside nodes that were already noted as inserted
    if (added.indexOf(mut.target) > -1) return null
    let desc = this.view.docView.nearestDesc(mut.target)
    if (mut.type == "attributes" &&
        (desc == this.view.docView || mut.attributeName == "contenteditable" ||
         // Firefox sometimes fires spurious events for null/empty styles
         (mut.attributeName == "style" && !mut.oldValue && !(mut.target as HTMLElement).getAttribute("style"))))
      return null
    if (!desc || desc.ignoreMutation(mut)) return null

    if (mut.type == "childList") {
      for (let i = 0; i < mut.addedNodes.length; i++) added.push(mut.addedNodes[i])
      if (desc.contentDOM && desc.contentDOM != desc.dom && !desc.contentDOM.contains(mut.target))
        return {from: desc.posBefore, to: desc.posAfter}
      let prev = mut.previousSibling, next = mut.nextSibling
      if (browser.ie && browser.ie_version <= 11 && mut.addedNodes.length) {
        // IE11 gives us incorrect next/prev siblings for some
        // insertions, so if there are added nodes, recompute those
        for (let i = 0; i < mut.addedNodes.length; i++) {
          let {previousSibling, nextSibling} = mut.addedNodes[i]
          if (!previousSibling || Array.prototype.indexOf.call(mut.addedNodes, previousSibling) < 0) prev = previousSibling
          if (!nextSibling || Array.prototype.indexOf.call(mut.addedNodes, nextSibling) < 0) next = nextSibling
        }
      }
      let fromOffset = prev && prev.parentNode == mut.target
          ? domIndex(prev) + 1 : 0
      let from = desc.localPosFromDOM(mut.target, fromOffset, -1)
      let toOffset = next && next.parentNode == mut.target
          ? domIndex(next) : mut.target.childNodes.length
      let to = desc.localPosFromDOM(mut.target, toOffset, 1)
      return {from, to}
    } else if (mut.type == "attributes") {
      return {from: desc.posAtStart - desc.border, to: desc.posAtEnd + desc.border}
    } else { // "characterData"
      return {
        from: desc.posAtStart,
        to: desc.posAtEnd,
        // An event was generated for a text change that didn't change
        // any text. Mark the dom change to fall back to assuming the
        // selection was typed over with an identical value if it can't
        // find another change.
        typeOver: mut.target.nodeValue == mut.oldValue
      }
    }
  }
}

let cssChecked: WeakMap<EditorView, null> = new WeakMap()
let cssCheckWarned: boolean = false

function checkCSS(view: EditorView) {
  if (cssChecked.has(view)) return
  cssChecked.set(view, null)
  if (['normal', 'nowrap', 'pre-line'].indexOf(getComputedStyle(view.dom).whiteSpace) !== -1) {
    view.requiresGeckoHackNode = browser.gecko
    if (cssCheckWarned) return
    console["warn"]("ProseMirror expects the CSS white-space property to be set, preferably to 'pre-wrap'. It is recommended to load style/prosemirror.css from the prosemirror-view package.")
    cssCheckWarned = true
  }
}
