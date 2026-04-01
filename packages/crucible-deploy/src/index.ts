#!/usr/bin/env node

import { Command } from "commander"
import { applyCommand } from "./commands/apply.js"
import { verifyCommand } from "./commands/verify.js"
import { registerCommand } from "./commands/register.js"
import { rollbackCommand } from "./commands/rollback.js"

const program = new Command()
    .name("crucible-deploy")
    .description("Crucible game deployment tool for CI pipelines")
    .version("0.1.0")

program.addCommand(applyCommand)
program.addCommand(verifyCommand)
program.addCommand(registerCommand)
program.addCommand(rollbackCommand)

program.parse()
