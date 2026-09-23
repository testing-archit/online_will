#!/usr/bin/env node
// Seeds the very first staff account directly through the store, since there's no admin yet to use the
// admin-only /api/admin/staff endpoint. Run once per environment:
//   npm run create-admin -- --email=you@example.com --password=... --name="Your Name" [--role=admin]
import { bootstrapStaffAccount, STAFF_ROLES } from '../server/staffAuth.mjs'

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    const match = arg.match(/^--([a-zA-Z]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const role = args.role || 'admin'

if (!args.email || !args.password || !args.name) {
  console.error('Usage: npm run create-admin -- --email=you@example.com --password=... --name="Your Name" [--role=admin|lawyer|advisor]')
  process.exit(1)
}
if (!STAFF_ROLES.includes(role)) {
  console.error(`--role must be one of ${STAFF_ROLES.join(', ')}`)
  process.exit(1)
}
if (args.password.length < 10) {
  console.error('--password must be at least 10 characters')
  process.exit(1)
}

try {
  const account = await bootstrapStaffAccount({ email: args.email, password: args.password, fullName: args.name, role })
  console.log(`Created ${account.role} account: ${account.email} (id ${account.id})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
