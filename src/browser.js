const has_navigator = typeof navigator != "undefined"
const ie_upto10 = has_navigator ? /MSIE \d/.test(navigator.userAgent) : false
const ie_11up = has_navigator ? /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent) : false

module.exports = {
  mac: has_navigator ? /Mac/.test(navigator.platform) : false,
  ie: ie_upto10 || !!ie_11up,
  ie_version: (ie_upto10 && typeof document != "undefined") ? document.documentMode || 6 : ie_11up && +ie_11up[1],
  gecko: has_navigator ? /gecko\/\d/i.test(navigator.userAgent) : false,
  ios: has_navigator ? (/AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent)) : false
}
