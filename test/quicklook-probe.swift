// Loaded into the Quick Look helper with DYLD_INSERT_LIBRARIES by test/prism-quicklook.test.ts.
// It runs the JSON steps in QLF_PROBE_STEPS against the open panel, writes what it saw to QLF_PROBE_OUT and exits.

import Cocoa
import QuickLookUI

struct ProbeStep: Decodable {
  let op: String
  let width: Double?
  let label: String?
  let seconds: Double?
  let key: String?
}

final class Probe {
  static let shared = Probe()
  private let env = ProcessInfo.processInfo.environment
  private var steps: [ProbeStep] = []
  private var results: [[String: Any]] = []
  private let started = Date()

  func begin() {
    guard let json = env["QLF_PROBE_STEPS"]?.data(using: .utf8),
          let parsed = try? JSONDecoder().decode([ProbeStep].self, from: json) else {
      return finish(error: "QLF_PROBE_STEPS is missing or invalid")
    }
    steps = parsed
    waitUntilReady()
  }

  private var panel: QLPreviewPanel? { QLPreviewPanel.shared() }

  private var titleBar: NSStackView? {
    guard let root = panel?.contentView?.superview else { return nil }
    return find(in: root) { NSStringFromClass(type(of: $0)).contains("QLPreviewTitleBarView") } as? NSStackView
  }

  // Quick Look adds its own Share and Open buttons about 250 ms after the panel opens, after the helper's zoom pill.
  private func waitUntilReady() {
    if let bar = titleBar, find(in: bar, where: { action(of: $0) == "share:" }) != nil {
      after(0.5) { self.run(0) }
    } else if Date().timeIntervalSince(started) > 15 {
      finish(error: "the Quick Look title bar never got its controls")
    } else {
      after(0.05) { self.waitUntilReady() }
    }
  }

  private func run(_ index: Int) {
    guard index < steps.count else { return finish(error: nil) }
    guard let panel = panel else { return finish(error: "the panel is gone") }
    // A Quick Look panel opened by another process empties this one ("No items selected").
    guard panel.currentPreviewItem != nil else {
      return finish(error: "the panel lost its preview, most likely to another Quick Look panel opened meanwhile")
    }
    let step = steps[index]
    let next = { (delay: Double) in self.after(delay) { self.run(index + 1) } }
    switch step.op {
    case "layout":
      results.append(layout())
      next(0)
    case "drag", "resize":
      // A user's drag stops at minSize; setFrame does not, so "resize" reaches below it.
      var width = CGFloat(step.width ?? Double(panel.frame.width))
      if step.op == "drag" { width = max(width, panel.minSize.width) }
      var frame = panel.frame
      frame.size.width = width
      panel.setFrame(frame, display: true)
      next(0.6)
    case "press":
      guard let bar = titleBar, let button = find(in: bar, where: { label(of: $0) == step.label }) as? NSButton else {
        return finish(error: "no button labelled \(step.label ?? "")")
      }
      button.performClick(nil)
      next(step.seconds ?? 1)
    case "scale":
      results.append(scale())
      next(0)
    case "enterFullscreen":
      panel.enterFullScreenMode(nil, withOptions: nil)
      next(step.seconds ?? 2.5)
    case "exitFullscreen":
      panel.exitFullScreenMode(options: nil)
      next(step.seconds ?? 2.5)
    // The closing ops end the steps and leave exiting to the helper; the test checks that it does.
    case "close":
      panel.close()
    case "clickClose":
      guard let root = panel.contentView?.superview,
            let button = find(in: root, where: { action(of: $0) == "close" }) as? NSButton else {
        return finish(error: "no close button")
      }
      button.performClick(nil)
    case "key":
      let keys: [String: (code: UInt16, characters: String)] = ["space": (49, " "), "escape": (53, "\u{1b}")]
      guard let key = keys[step.key ?? ""],
            let event = NSEvent.keyEvent(
              with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
              windowNumber: panel.windowNumber, context: nil, characters: key.characters,
              charactersIgnoringModifiers: key.characters, isARepeat: false, keyCode: key.code) else {
        return finish(error: "unknown key \(step.key ?? "")")
      }
      panel.sendEvent(event)
    default:
      finish(error: "unknown op \(step.op)")
    }
  }

  private func layout() -> [String: Any] {
    guard let panel = panel, let bar = titleBar else { return ["op": "layout", "error": "no title bar"] }
    bar.layoutSubtreeIfNeeded()
    let items: [[String: Any]] = bar.arrangedSubviews.filter { !$0.isHidden }.map { view in
      var item: [String: Any] = ["kind": kind(of: view), "frame": rect(view.frame), "fittingWidth": view.fittingSize.width]
      if let field = view as? NSTextField {
        item["text"] = field.stringValue
        item["fullWidth"] = field.intrinsicContentSize.width
        // Quick Look sets the title's truncation in the attributed string, not on the field.
        let style = field.attributedStringValue.length > 0
          ? field.attributedStringValue.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle : nil
        item["lineBreakMode"] = (style?.lineBreakMode ?? field.lineBreakMode).rawValue
      } else if !(view is NSButton) {
        item["buttons"] = all(in: view).compactMap { $0 as? NSButton }.map { button -> [String: Any] in
          [
            "label": label(of: button) ?? "",
            "title": button.title,
            "toolTip": button.toolTip ?? "",
            "frame": rect(button.convert(button.alignmentRect(forFrame: button.bounds), to: bar)),
            "fittingWidth": button.fittingSize.width,
          ]
        }
      }
      return item
    }
    let root = panel.contentView?.superview ?? bar
    return [
      "op": "layout",
      "panel": rect(panel.frame),
      "minSize": [panel.minSize.width, panel.minSize.height],
      "titleBar": rect(bar.frame),
      "items": items,
      "openButtons": all(in: root).filter { action(of: $0) == "open:" && !$0.isHiddenOrHasHiddenAncestor }.count,
    ]
  }

  // Screenshots the panel and measures how wide the preview draws the image's 10 px stripes, in points per image pixel.
  private func scale() -> [String: Any] {
    guard CGPreflightScreenCaptureAccess() else { return ["op": "scale", "error": "screen capture is not allowed"] }
    guard let panel = panel, let root = panel.contentView?.superview,
          let content = find(in: root, where: { NSStringFromClass(type(of: $0)).contains("QLPreviewContainerView") }) else {
      return ["op": "scale", "error": "no preview view"]
    }
    let file = NSTemporaryDirectory() + "qlf-probe-\(getpid())-\(results.count).png"
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    capture.arguments = ["-o", "-x", "-l", "\(panel.windowNumber)", file]
    try? capture.run()
    capture.waitUntilExit()
    guard let data = FileManager.default.contents(atPath: file), let image = NSBitmapImageRep(data: data) else {
      return ["op": "scale", "error": "screencapture failed"]
    }
    let pixelsPerPoint = CGFloat(image.pixelsWide) / panel.frame.width
    let box = content.convert(content.bounds, to: nil)
    let row = Int((panel.frame.height - box.midY) * pixelsPerPoint)
    var runs: [Int] = []
    var current: Character = " "
    var length = 0
    for x in Int(box.minX * pixelsPerPoint)..<Int(box.maxX * pixelsPerPoint) {
      guard let color = image.colorAt(x: x, y: row) else { continue }
      let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
      let stripe: Character = r > 0.6 && g < 0.4 && b < 0.4 ? "r" : b > 0.6 && r < 0.4 && g < 0.4 ? "b" : " "
      if stripe == current {
        length += 1
      } else {
        if current != " " { runs.append(length) }
        current = stripe
        length = 1
      }
    }
    if current != " " { runs.append(length) }
    // The stripes at either edge of the view may be cut off.
    let whole = runs.count > 2 ? Array(runs.dropFirst().dropLast()) : runs
    // Keep the capture when it shows no stripes, so the failure can be looked at.
    guard !whole.isEmpty else { return ["op": "scale", "error": "no stripes on screen in \(file)"] }
    try? FileManager.default.removeItem(atPath: file)
    let mean = CGFloat(whole.reduce(0, +)) / CGFloat(whole.count)
    return ["op": "scale", "scale": mean / pixelsPerPoint / 10]
  }

  private func kind(of view: NSView) -> String {
    if view is NSTextField { return "title" }
    if let action = action(of: view) { return action == "close" ? "close" : action == "enterFullscreen:" ? "fullscreen" : action }
    if find(in: view, where: { label(of: $0) == "Zoom In" }) != nil { return "zoom" }
    if find(in: view, where: { action(of: $0) == "share:" }) != nil { return "native" }
    return NSStringFromClass(type(of: view))
  }

  private func label(of view: NSView) -> String? {
    guard let button = view as? NSButton else { return nil }
    if let text = button.accessibilityLabel(), !text.isEmpty { return text }
    return button.image?.accessibilityDescription
  }

  private func action(of view: NSView) -> String? {
    guard let control = view as? NSControl, let action = control.action else { return nil }
    return NSStringFromSelector(action)
  }

  private func find(in root: NSView, where match: (NSView) -> Bool) -> NSView? {
    if match(root) { return root }
    for sub in root.subviews {
      if let found = find(in: sub, where: match) { return found }
    }
    return nil
  }

  private func all(in root: NSView) -> [NSView] {
    return [root] + root.subviews.flatMap { all(in: $0) }
  }

  private func rect(_ r: NSRect) -> [CGFloat] {
    return [r.minX, r.minY, r.width, r.height]
  }

  private func after(_ seconds: Double, _ work: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
  }

  private func finish(error: String?) {
    var report: [String: Any] = ["results": results]
    if let error = error { report["error"] = error }
    if let out = env["QLF_PROBE_OUT"], let data = try? JSONSerialization.data(withJSONObject: report) {
      FileManager.default.createFile(atPath: out, contents: data)
    }
    exit(0)
  }
}

@_cdecl("qlf_probe_start")
public func qlfProbeStart() {
  DispatchQueue.main.async { Probe.shared.begin() }
}
