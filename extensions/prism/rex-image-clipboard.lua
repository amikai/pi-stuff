-- Turns a prism image copy into a real image on the clipboard of the Mac this runs on.
--
-- Run it on the Mac you sit at, the one that runs the Rex app, not on the Mac pi runs on. prism sends
-- the PNG through Rex as text in parts, prism-png:<id>:<i>/<n>:<base64>, and this script collects the
-- parts and puts the PNG on the clipboard. Start it in a terminal on that Mac and leave it running:
--
--   rex -S <address of the Rex server pi runs on> do --all rex-image-clipboard.lua
--
-- It is needed only when prism.json sets "rexImageCopy": true.
local PUT = [=[
ObjC.import("AppKit");
function run(argv) {
	const pb = $.NSPasteboard.generalPasteboard;
	const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
	const data = $.NSData.alloc.initWithBase64EncodedDataOptions(input, 1);
	if (data.isNil() || data.length === 0) return "bad base64";
	const text = () => ObjC.unwrap(pb.stringForType("public.utf8-plain-text")) || "";
	const put = () => (pb.clearContents, pb.setDataForType(data, "public.png"));
	// The Rex app puts every part on the pasteboard as text. Write the image after the last one lands.
	for (let i = 0; i < 10 && !text().startsWith(argv[0]); i++) delay(0.2);
	if (!put()) return "pasteboard refused the image";
	delay(0.5);
	if (text().startsWith("prism-png:")) put();
	return "image, " + data.length + " bytes";
}
]=]

local id, n, got, parts

rex.on("terminal.clipboard_written", function(ctx, ev)
	local pid, i, pn, data = (ev.text or ""):match("^prism%-png:(%w+):(%d+)/(%d+):(.*)$")
	if not pid then return end
	i, pn = tonumber(i), tonumber(pn)
	if pid ~= id then id, n, got, parts = pid, pn, 0, {} end
	if not parts[i] then parts[i], got = data, got + 1 end
	if got < n then return end
	local last = "prism-png:" .. id .. ":" .. n .. "/" .. n .. ":"
	local r, err = rex.exec({ "/usr/bin/osascript", "-l", "JavaScript", "-e", PUT, last }, { stdin = table.concat(parts, "", 1, n), timeout = 10 })
	id = nil
	print(r and (r.stdout:gsub("%s+$", "")) or err)
end)
