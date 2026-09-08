const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
test('captured production private Meet policy remains TRUSTED', () => {
 const app = readFileSync('src/app.ts', 'utf8')
 assert.match(app, /createMeetLink\(ctx\.dbuser, 'TRUSTED'\)/)
 assert.doesNotMatch(app, /createMeetLink\(ctx\.dbuser, 'DEFAULT'/)
})
