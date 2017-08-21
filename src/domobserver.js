import browser from "./browser"
import {DOMChange} from "./domchange"
import {domIndex} from "./dom"

const observeOptions = {childList: true, characterData: true, attributes: true, subtree: true, characterDataOldValue: true}
// IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
const useCharData = browser.ie && browser.ie_version <= 11

export class DOMObserver {
  constructor(view) {
    this.view = view
    this.observer = window.MutationObserver &&
      new window.MutationObserver(mutations => this.registerMutations(mutations))
    if (useCharData)
      this.onCharData = e => this.registerMutation({target: e.target, type: "characterData", oldValue: e.prevValue})
  }

  start() {
    if (this.observer)
      this.observer.observe(this.view.dom, observeOptions)
    if (useCharData)
      this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
  }

  stop() {
    if (this.observer) {
      this.flush()
      this.observer.disconnect()
    }
    if (useCharData)
      this.view.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
  }

  flush() {
    if (this.observer)
      this.registerMutations(this.observer.takeRecords())
  }

  registerMutations(mutations) {
    for (let i = 0; i < mutations.length; i++)
      this.registerMutation(mutations[i])
  }

  registerMutation(mut) {
    if (!this.view.editable) return
    let desc = this.view.docView.nearestDesc(mut.target)
    if (mut.type == "attributes" &&
        (desc == this.view.docView || mut.attributeName == "contenteditable")) return
    if (!desc || desc.ignoreMutation(mut)) return

    let from, to
    if (mut.type == "childList") {
      let fromOffset = mut.previousSibling && mut.previousSibling.parentNode == mut.target
          ? domIndex(mut.previousSibling) + 1 : 0
      if (fromOffset == -1) return
      from = desc.localPosFromDOM(mut.target, fromOffset, -1)
      let toOffset = mut.nextSibling && mut.nextSibling.parentNode == mut.target
          ? domIndex(mut.nextSibling) : mut.target.childNodes.length
      if (toOffset == -1) return
      to = desc.localPosFromDOM(mut.target, toOffset, 1)
    } else if (mut.type == "attributes") {
      from = desc.posAtStart - desc.border
      to = desc.posAtEnd + desc.border
    } else { // "characterData"
      from = desc.posAtStart
      to = desc.posAtEnd
      // An event was generated for a text change that didn't change
      // any text. Mark the dom change to fall back to assuming the
      // selection was typed over with an identical value if it can't
      // find another change.
      if (mut.target.nodeValue == mut.oldValue) DOMChange.start(this.view).typeOver = true
    }

    DOMChange.start(this.view).addRange(from, to)
  }
}
