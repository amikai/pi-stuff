#!/usr/bin/env swift

import Cocoa
import QuickLookUI

struct KeyShortcut {
  let characters: String
  let keyCode: UInt16
}

// The segments of Preview's zoom_and_actual toolbar item, in its order and with its symbols and tooltips.
enum ZoomSegment: Int, CaseIterable {
  case zoomOut = 0
  case actualSize = 1
  case zoomIn = 2

  var symbolName: String {
    switch self {
    case .zoomOut: return "minus.magnifyingglass"
    case .actualSize: return "1.magnifyingglass"
    case .zoomIn: return "plus.magnifyingglass"
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .zoomOut: return "Zoom Out"
    case .actualSize: return "Actual Size"
    case .zoomIn: return "Zoom In"
    }
  }

  var toolTip: String {
    switch self {
    case .zoomOut: return "Scale document down"
    case .actualSize: return "Display at actual size"
    case .zoomIn: return "Scale document up"
    }
  }

  var shortcut: KeyShortcut {
    switch self {
    case .zoomOut: return KeyShortcut(characters: "-", keyCode: 27)
    case .actualSize: return KeyShortcut(characters: "0", keyCode: 29)
    case .zoomIn: return KeyShortcut(characters: "=", keyCode: 24)
    }
  }
}

class FloatingPreview: NSObject, NSApplicationDelegate, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
  let urls: [URL]
  private weak var panel: QLPreviewPanel?

  init(paths: [String]) {
    self.urls = paths.compactMap { path -> URL? in
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: path) else {
        return nil
      }
      return url
    }
    super.init()
  }

  override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool {
    return true
  }

  override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
    self.panel = panel
    panel.dataSource = self
    panel.delegate = self
    // Quick Look resets the panel level and populates the title bar when it takes control on the next run-loop turn.
    DispatchQueue.main.async { [weak self, weak panel] in
      guard let self = self, let panel = panel else { return }
      panel.level = .floating
      self.installZoomControls(on: panel)
    }
  }

  override func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
    panel.dataSource = nil
    panel.delegate = nil
  }

  func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
    return urls.count
  }

  func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
    return urls[index] as QLPreviewItem
  }

  @objc private func panelWillClose(_ notification: Notification) {
    NSApp.terminate(nil)
  }

  private func findView(in root: NSView, className: String) -> NSView? {
    if NSStringFromClass(type(of: root)).contains(className) {
      return root
    }
    for sub in root.subviews {
      if let found = findView(in: sub, className: className) {
        return found
      }
    }
    return nil
  }

  private func makeIconButton(symbol: String, accessibility: String, tag: Int = 0, action: Selector) -> NSButton {
    let config = NSImage.SymbolConfiguration(pointSize: 12, weight: .semibold)
    let img = NSImage(systemSymbolName: symbol, accessibilityDescription: accessibility)?
      .withSymbolConfiguration(config) ?? NSImage()
    let btn = NSButton(image: img, target: self, action: action)
    btn.tag = tag
    btn.isBordered = false
    btn.contentTintColor = .labelColor
    btn.translatesAutoresizingMaskIntoConstraints = false
    return btn
  }

  private func makeDivider(height: CGFloat) -> NSBox {
    let div = NSBox()
    div.boxType = .custom
    div.borderWidth = 0
    div.fillColor = NSColor.labelColor.withAlphaComponent(0.22)
    div.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      div.widthAnchor.constraint(equalToConstant: 1),
      div.heightAnchor.constraint(equalToConstant: height * 0.55),
    ])
    return div
  }

  private func wrapInGlass(_ content: NSView, height: CGFloat = 24) -> NSView {
    if #available(macOS 26.0, *) {
      let glass = NSGlassEffectView()
      glass.translatesAutoresizingMaskIntoConstraints = false
      glass.style = .regular
      glass.cornerRadius = height / 2
      if #available(macOS 27.0, *) {
        glass.effectIsInteractive = true
      }
      content.translatesAutoresizingMaskIntoConstraints = false
      glass.contentView = content
      NSLayoutConstraint.activate([
        glass.heightAnchor.constraint(equalToConstant: height),
      ])
      return glass
    }
    return content
  }

  // The title bar is a stack view. Arranged in it, the pill makes the title truncate, and Quick Look appends Share and Open after it, shortening Open when space runs out.
  private func installZoomControls(on panel: QLPreviewPanel) {
    guard let root = panel.contentView?.superview ?? panel.contentView,
          let titleBar = findView(in: root, className: "QLPreviewTitleBarView") as? NSStackView else { return }
    let barID = NSUserInterfaceItemIdentifier("qlf.zoomControls")
    if titleBar.arrangedSubviews.contains(where: { $0.identifier == barID }) { return }

    let pillHeight: CGFloat = 24

    let zoomRow = NSStackView()
    zoomRow.orientation = .horizontal
    zoomRow.spacing = 0
    zoomRow.alignment = .centerY
    zoomRow.edgeInsets = NSEdgeInsets(top: 0, left: 6, bottom: 0, right: 6)
    zoomRow.translatesAutoresizingMaskIntoConstraints = false
    for (index, segment) in ZoomSegment.allCases.enumerated() {
      if index > 0 {
        zoomRow.addArrangedSubview(makeDivider(height: pillHeight))
      }
      let btn = makeIconButton(
        symbol: segment.symbolName,
        accessibility: segment.accessibilityLabel,
        tag: segment.rawValue,
        action: #selector(zoomSegmentClicked(_:))
      )
      btn.toolTip = segment.toolTip
      NSLayoutConstraint.activate([
        btn.widthAnchor.constraint(equalToConstant: 28),
        btn.heightAnchor.constraint(equalToConstant: pillHeight),
      ])
      zoomRow.addArrangedSubview(btn)
    }
    // Before macOS 26 the row is the pill itself, and a stack view that does not hug stretches across the title bar's free space.
    zoomRow.setHuggingPriority(.defaultHigh, for: .horizontal)
    let zoomGlass = wrapInGlass(zoomRow, height: pillHeight)
    zoomGlass.identifier = barID
    titleBar.insertView(zoomGlass, at: 0, in: .trailing)
  }

  private func sendCommandShortcut(_ shortcut: KeyShortcut) {
    guard let panel = panel,
          let event = NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.command],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: panel.windowNumber,
            context: nil,
            characters: shortcut.characters,
            charactersIgnoringModifiers: shortcut.characters,
            isARepeat: false,
            keyCode: shortcut.keyCode
          ) else { return }
    _ = panel.performKeyEquivalent(with: event)
  }

  @objc private func zoomSegmentClicked(_ sender: NSButton) {
    guard let segment = ZoomSegment(rawValue: sender.tag) else { return }
    sendCommandShortcut(segment.shortcut)
  }

  func previewPanel(_ panel: QLPreviewPanel!, handle event: NSEvent!) -> Bool {
    guard event.type == .keyDown else { return false }
    switch event.keyCode {
    case 49, 53:
      panel.close()
      NSApp.terminate(nil)
      return true
    default:
      return false
    }
  }

  func run() {
    guard !urls.isEmpty else {
      exit(1)
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.delegate = self

    guard let panel = QLPreviewPanel.shared() else {
      exit(1)
    }
    self.panel = panel
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(panelWillClose(_:)),
      name: NSWindow.willCloseNotification,
      object: panel
    )
    panel.makeKeyAndOrderFront(nil)

    // activate() from macOS 14 only takes focus when the frontmost app yields it, so the panel would open behind the terminal.
    app.activate(ignoringOtherApps: true)
    app.run()
  }
}

guard CommandLine.arguments.count > 1 else {
  print("Usage: qlf <file> [file2] ...")
  exit(1)
}

let paths = Array(CommandLine.arguments.dropFirst())
let preview = FloatingPreview(paths: paths)
preview.run()
