const {Mapping} = require("prosemirror-transform")

class TrackedRecord {
  constructor(prev, mapping, state) {
    this.prev = prev
    this.mapping = mapping
    this.state = state
  }
}

class TrackMappings {
  constructor(state) {
    this.seen = [new TrackedRecord(null, null, state)]
  }

  find(state) {
    for (let i = this.seen.length - 1; i >= 0; i--) {
      let record = this.seen[i]
      if (record.state == state) return record
    }
  }

  track(old, action, state) {
    let found = this.seen.length < 200 ? this.find(old) : null
    if (found)
      this.seen.push(new TrackedRecord(found, action.type == "transform" ? action.transform.mapping : null, state))
  }

  getMapping(state) {
    let found = this.find(state)
    if (!found) return null
    let mappings = []
    for (let rec = found; rec; rec = rec.prev)
      if (rec.mapping) mappings.push(rec.mapping)
    let result = new Mapping
    for (let i = mappings.length - 1; i >= 0; i--)
      result.appendMapping(mappings[i])
    return result
  }
}
exports.TrackMappings = TrackMappings
