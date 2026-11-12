-- Runs on the Mac you sit at, against the Rex server pi runs on:
--   rex -S <address of that Rex server> do --all rex-image-clipboard.lua
-- It moves pictures between that Mac's clipboard and prism, in both directions.
local TERMINAL = "com.superlogical.terminal"

-- 1. prism to this Mac. prism sends a PNG as text in parts, prism-png:<id>:<i>/<n>:<base64>.
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

-- 2. This Mac to prism. prism asks with a status report (OSC 7501, app=prism, the message below with
-- a number). The picture on the clipboard is uploaded to /tmp/prism-paste-<number>.png beside the Rex
-- server, or the reason there is none to /tmp/prism-paste-<number>.err. prism waits for one of the two.
local WANTED = "^clipboard image wanted (%d+)$"
-- A request to the Rex server may hold at most 64 KiB.
local CHUNK = 48000
local READ = [=[
// Prints the picture on the clipboard as base64 PNG, or "none: <what the clipboard holds>".
ObjC.import("AppKit");
function run(argv) {
	const pb = argv[0] ? $.NSPasteboard.pasteboardWithName(argv[0]) : $.NSPasteboard.generalPasteboard;
	let png = pb.dataForType("public.png");
	if (png.isNil()) {
		// NSImage also reads TIFF, JPEG, HEIC, PDF and an image file copied in Finder.
		const image = $.NSImage.alloc.initWithPasteboard(pb);
		const tiff = image.isNil() ? $() : image.TIFFRepresentation;
		if (tiff.isNil()) return "none: " + ObjC.deepUnwrap(pb.types || $([])).join(" ");
		png = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
	}
	return ObjC.unwrap(png.base64EncodedStringWithOptions(0));
}
]=]
local RECEIVE = 'umask 077; stty -icanon -echo; perl -e \'alarm 30; exec @ARGV\' head -c "$1" | base64 --decode > "$2.part" && mv "$2.part" "$2"'

-- Writes base64 text to a file beside the Rex server. Returns a reason when it fails.
local function upload(data, dest)
	local w, err = rex.session.new_window{
		focus = false,
		layout = rex.layout.block{
			flavor = "com.superlogical.terminal.shell",
			label = "prism paste",
			options = { command = { "/bin/sh", "-c", RECEIVE, "sh", tostring(#data), dest } },
		},
	}
	local receiver = w and w.block_ids and w.block_ids[1]
	if not receiver then return tostring(err) end
	rex.sleep(0.3)
	for i = 1, #data, CHUNK do
		local ok, e = rex.block.call(TERMINAL, "write", { block_id = receiver, data = data:sub(i, i + CHUNK - 1) })
		if not ok then return tostring(e) end
	end
	local done = rex.wait("terminal.child_exited", { block_id = receiver }, 35)
	if not done or done.exit_code ~= 0 then return "the upload did not finish" end
end

rex.on("terminal.program_status_changed", function(ctx, ev)
	local record = ev.record or {}
	local number = record.app == "prism" and (record.msg or ""):match(WANTED)
	if not number then return end
	local base = "/tmp/prism-paste-" .. number
	local r, err = rex.exec({ "/usr/bin/osascript", "-l", "JavaScript", "-e", READ }, { timeout = 10 })
	local out = r and (r.ok and r.stdout or "none: " .. r.stderr) or "none: " .. tostring(err)
	out = out:gsub("%s+$", "")
	if out == "" or out:sub(1, 5) == "none:" then
		local why = "no image on the clipboard of the Mac you sit at"
		local encoded = rex.exec({ "/usr/bin/base64" }, { stdin = why })
		upload(encoded and (encoded.stdout:gsub("%s", "")) or "", base .. ".err")
		print("paste: " .. why .. ", it holds: " .. out:sub(7))
		return
	end
	local failed = upload(out, base .. ".png")
	print("paste: " .. (failed or (base .. ".png, " .. math.floor(#out * 3 / 4) .. " bytes")))
end)
