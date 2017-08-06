import {EditorState} from "prosemirror-state"
import {Mapping} from "prosemirror-transform"

class TrackedRecord {
  constructor(prev, mapping, state) {
    this.prev = prev
    this.mapping = mapping
    this.state = state
  }
}

export class TrackMappings {
  constructor(state) {
    this.seen = [new TrackedRecord(null, null, state)]
    // Kludge to listen to state changes globally in order to be able
    // to find mappings from a given state to another.
    EditorState.addApplyListener(this.track = this.track.bind(this))
  }

  destroy() {
    EditorState.removeApplyListener(this.track)
  }

  find(state) {
    for (let i = this.seen.length - 1; i >= 0; i--) {
      let record = this.seen[i]
      if (record.state == state) return record
    }
  }

  track(old, tr, state) {
    let found = this.seen.length < 200 ? this.find(old) : null
    if (found)
      this.seen.push(new TrackedRecord(found, tr.docChanged ? tr.mapping : null, state))
  }

  getMapping(state, appendTo) {
    let found = this.find(state)
    if (!found) return null
    let mappings = []
    for (let rec = found; rec; rec = rec.prev)
      if (rec.mapping) mappings.push(rec.mapping)
    let result = appendTo || new Mapping
    for (let i = mappings.length - 1; i >= 0; i--)
      result.appendMapping(mappings[i])
    return result
  }
}
