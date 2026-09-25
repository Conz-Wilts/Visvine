// @visvine/tool-kit runs inside a Visvine Tool's frame, where the frame's
// import map serves it. Outside one — a test, a script — there is nothing to
// run: `visvine-tool dev` serves a Tool against its fixtures, and
// `@visvine/tool-kit/mock` answers its bridge in Node.
throw new Error('@visvine/tool-kit runs inside a Visvine Tool frame — run `visvine-tool dev` to see your Tool.')
