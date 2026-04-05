// Schema-driven dispatch: tools.json → category → action → handler
// Reads schema definitions, validates input via ObjectTree, routes to handlers.

import { ObjectTree } from '../lib/schema2object.mjs'
import { formatOutput } from './output.mjs'

// localHandlers: { categoryName: { actionName: fn } }
export function createDispatch(bus, toolsSchema, loader, localHandlers = {}, ctx = {}) {
  const categories = new Map()

  for (const cat of toolsSchema.tools) {
    const actionMap = new Map()
    for (const action of cat.actions) {
      actionMap.set(action.name, action)
    }
    categories.set(cat.name, { description: cat.description, actions: actionMap })
  }

  // Resolve OutputFormat definition from schema tree — single source of truth
  let outputFormatSchema = { type: 'string', default: 'md' }
  try {
    const { node } = loader.resolve('config.json#/definitions/OutputFormat', null, null)
    outputFormatSchema = node
  } catch {}

  // L1: tool list — action enum + format only. No property merging.
  function getToolList() {
    const tools = []
    for (const [catName, cat] of categories) {
      const actionNames = [...cat.actions.keys()]
      const summaries = actionNames.map(n => `${n}: ${cat.actions.get(n).summary}`)
      tools.push({
        name: catName,
        description: `${cat.description} Actions: ${summaries.join(', ')}`,
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: actionNames,
              description: 'Action to execute. Omit to list available actions.'
            },
            format: { ...outputFormatSchema, description: 'Output format. Default: ' + (outputFormatSchema.default || 'md') }
          },
          // Allow additional properties — L2 resolves per-action schema on dispatch
          additionalProperties: true
        }
      })
    }
    return tools
  }

  bus.handle('dispatch', async ({ name: categoryName, arguments: rawArgs }) => {
    const args = rawArgs || {}
    const { action, format, ...rest } = args
    const outputFormat = format || ctx.output?.format

    const cat = categories.get(categoryName)
    if (!cat) throw new Error(`unknown category: ${categoryName}`)

    // L1: no action → show action list with args summary
    if (!action) {
      const list = [...cat.actions.values()].map(a => {
        const entry = { name: a.name, summary: a.summary }
        if (a.inputSchema?.$ref) {
          try {
            const { node } = loader.resolve(a.inputSchema.$ref, loader.scopeOf(a.inputSchema), loader.resourceOf(a.inputSchema))
            if (node.properties) {
              entry.args = Object.entries(node.properties).map(([k, v]) => {
                const arg = { name: k, type: v.type || v.oneOf?.map(o => o.type).join('|') || 'any' }
                if (v.enum) arg.values = v.enum
                if (v.default !== undefined) arg.default = v.default
                return arg
              })
              if (node.required?.length) entry.required = node.required
            }
          } catch {}
        }
        return entry
      })
      const out = formatOutput(list, outputFormat, ctx.output, { category: categoryName, action: '_list' })
      return { status: 200, data: out.data }
    }

    const actionDef = cat.actions.get(action)
    if (!actionDef) {
      const available = [...cat.actions.keys()].join(', ')
      throw new Error(`unknown action: ${action}. Available: ${available}`)
    }

    // Route through bus: modules register as 'categoryName:action'
    const busEvent = `${categoryName}:${action}`
    const hasBusHandler = bus.has?.(busEvent)

    // Fallback to direct handler map (backward compat)
    const catHandlers = localHandlers[categoryName] || {}
    const fn = hasBusHandler ? null : catHandlers[action]
    if (!fn && !hasBusHandler) throw new Error(`no handler registered for: ${categoryName}.${action}`)

    const inputSchemaRef = actionDef.inputSchema
    if (!inputSchemaRef?.$ref) throw new Error(`action "${action}" inputSchema must use $ref`)
    const { node: resolvedSchema, loader: resolvedLoader } = loader.resolve(
      inputSchemaRef.$ref,
      loader.scopeOf(inputSchemaRef),
      loader.resourceOf(inputSchemaRef)
    )

    // L2: validate input — on failure, return action help with args + example
    let validated
    try {
      validated = new ObjectTree(rest, resolvedSchema, resolvedLoader).$withDefaults()
    } catch (e) {
      const help = {
        action, summary: actionDef.summary, error: e.message,
        args: _buildArgHelp(resolvedSchema),
        example: _buildExample(action, resolvedSchema),
        inputSchema: resolvedSchema
      }
      const out = formatOutput(help, outputFormat, ctx.output, { category: categoryName, action: '_help' })
      return { status: 200, data: out.data }
    }

    // L3: execute
    let result
    if (hasBusHandler) {
      result = await bus.send(busEvent, validated)
    } else {
      const actionCtx = { ...ctx, data: actionDef.data || {} }
      result = await fn(validated, actionCtx)
    }

    const out = formatOutput(result, outputFormat, ctx.output, { category: categoryName, action })
    return { status: 200, data: out.data }
  })

  // L2 helpers: build arg help and example from resolved schema
  function _buildArgHelp(schema) {
    if (!schema?.properties) return []
    return Object.entries(schema.properties).map(([k, v]) => {
      const arg = { name: k, type: v.type || v.oneOf?.map(o => o.type).join('|') || 'any' }
      if (v.enum) arg.values = v.enum
      if (v.default !== undefined) arg.default = v.default
      if (v.description) arg.description = v.description
      if (schema.required?.includes(k)) arg.required = true
      return arg
    })
  }

  function _buildExample(action, schema) {
    const example = { action }
    if (!schema?.properties) return example
    for (const [k, v] of Object.entries(schema.properties)) {
      if (v.default !== undefined) example[k] = v.default
      else if (v.const !== undefined) example[k] = v.const
      else if (v.enum?.length) example[k] = v.enum[0]
      else if (v.type === 'string') example[k] = `<${k}>`
      else if (v.type === 'boolean') example[k] = true
      else if (v.type === 'integer' || v.type === 'number') example[k] = 0
      else if (v.type === 'object') example[k] = {}
      else if (v.type === 'array') example[k] = []
    }
    return example
  }

  return { getToolList }
}
