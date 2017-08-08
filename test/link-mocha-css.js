let path = require("path"), child = require("child_process")

let source = path.resolve(path.dirname(require.resolve("mocha/mocha")), "mocha.css")
// declare global: __dirname
let dest = __dirname + "/mocha.css"

child.execFileSync("rm", ["-rf", dest], {stdio: "inherit"})
child.execFileSync("ln", ["-s", source, dest], {stdio: "inherit"})
