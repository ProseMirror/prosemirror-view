mocha.setup("bdd")

require("./test-draw")
require("./test-selection")
require("./test-domchange")

mocha.run()
