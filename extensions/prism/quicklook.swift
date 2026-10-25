#!/usr/bin/env swift

import Cocoa
import QuickLookUI

struct KeyShortcut {
  let characters: String
  let keyCode: UInt16
}

enum ZoomResetMode {
  case actualSize
  case fitToWindow

  var shortcut: KeyShortcut {
    switch self {
    case .actualSize: return KeyShortcut(characters: "0", keyCode: 29)
    case .fitToWindow: return KeyShortcut(characters: "9", keyCode: 25)
    }
  }

  var next: ZoomResetMode {
    switch self {
    case .actualSize: return .fitToWindow
    case .fitToWindow: return .actualSize
    }
  }
}

enum ZoomSegment: Int, CaseIterable {
  case zoomOut = 0
  case reset = 1
  case zoomIn = 2

  var symbolName: String {
    switch self {
    case .zoomOut: return "minus.magnifyingglass"
    case .reset: return "1.magnifyingglass"
    case .zoomIn: return "plus.magnifyingglass"
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .zoomOut: return "Zoom Out"
    case .reset: return "Actual Size"
    case .zoomIn: return "Zoom In"
    }
  }
}

class FloatingPreview: NSObject, NSApplicationDelegate, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
  let urls: [URL]
  private weak var panel: QLPreviewPanel?
  private var zoomResetMode: ZoomResetMode = .actualSize

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
      self.installLiquidGlassBar(on: panel)
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

  private func findControl(in root: NSView, actionName: String) -> NSControl? {
    if let ctrl = root as? NSControl, let action = ctrl.action, NSStringFromSelector(action) == actionName {
      return ctrl
    }
    for sub in root.subviews {
      if let found = findControl(in: sub, actionName: actionName) {
        return found
      }
    }
    return nil
  }

  private func findNativeControl(actionName: String) -> NSControl? {
    guard let root = panel?.contentView?.superview ?? panel?.contentView,
          let container = findView(in: root, className: "QLControlsContainerView") else {
      return nil
    }
    return findControl(in: container, actionName: actionName)
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

  private func installLiquidGlassBar(on panel: QLPreviewPanel) {
    guard let root = panel.contentView?.superview ?? panel.contentView else { return }
    let titleBar = findView(in: root, className: "QLPreviewTitleBarView")
    let host = titleBar ?? root
    let barID = NSUserInterfaceItemIdentifier("qlf.liquidGlassBar")
    if host.subviews.contains(where: { $0.identifier == barID }) { return }

    var openTitle = "Open with Preview"
    if let openBtn = findNativeControl(actionName: "open:") as? NSButton, !openBtn.title.isEmpty {
      openTitle = openBtn.title
    }

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
      NSLayoutConstraint.activate([
        btn.widthAnchor.constraint(equalToConstant: 28),
        btn.heightAnchor.constraint(equalToConstant: pillHeight),
      ])
      zoomRow.addArrangedSubview(btn)
    }
    let zoomGlass = wrapInGlass(zoomRow, height: pillHeight)

    let shareBtn = makeIconButton(
      symbol: "square.and.arrow.up",
      accessibility: "Share",
      action: #selector(shareClicked(_:))
    )
    NSLayoutConstraint.activate([
      shareBtn.widthAnchor.constraint(equalToConstant: 32),
      shareBtn.heightAnchor.constraint(equalToConstant: pillHeight),
    ])
    let shareGlass = wrapInGlass(shareBtn, height: pillHeight)

    let openBtn = NSButton(title: openTitle, target: self, action: #selector(openInPreviewClicked(_:)))
    openBtn.isBordered = false
    openBtn.font = NSFont.systemFont(ofSize: 12, weight: .medium)
    openBtn.contentTintColor = .labelColor
    openBtn.translatesAutoresizingMaskIntoConstraints = false

    let openWrap = NSStackView(views: [openBtn])
    openWrap.orientation = .horizontal
    openWrap.edgeInsets = NSEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
    openWrap.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      openBtn.heightAnchor.constraint(equalToConstant: pillHeight),
    ])
    let openGlass = wrapInGlass(openWrap, height: pillHeight)

    let hStack = NSStackView(views: [zoomGlass, shareGlass, openGlass])
    hStack.orientation = .horizontal
    hStack.alignment = .centerY
    hStack.spacing = 6
    hStack.translatesAutoresizingMaskIntoConstraints = false

    let bar: NSView
    if #available(macOS 26.0, *) {
      let container = NSGlassEffectContainerView()
      container.translatesAutoresizingMaskIntoConstraints = false
      container.spacing = 0
      container.contentView = hStack
      bar = container
    } else {
      bar = hStack
    }
    bar.identifier = barID

    if let titleBar = titleBar {
      if let centering = findView(in: titleBar, className: "QLControlsCenteringView") {
        centering.superview?.isHidden = true
      }
      titleBar.addSubview(bar)
      NSLayoutConstraint.activate([
        bar.centerYAnchor.constraint(equalTo: titleBar.centerYAnchor),
        bar.trailingAnchor.constraint(equalTo: titleBar.trailingAnchor, constant: -6),
      ])
    } else {
      root.addSubview(bar)
      NSLayoutConstraint.activate([
        bar.topAnchor.constraint(equalTo: root.topAnchor, constant: 6),
        bar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
      ])
    }
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
    switch segment {
    case .zoomOut:
      zoomResetMode = .actualSize
      sendCommandShortcut(KeyShortcut(characters: "-", keyCode: 27))
    case .reset:
      sendCommandShortcut(zoomResetMode.shortcut)
      zoomResetMode = zoomResetMode.next
    case .zoomIn:
      zoomResetMode = .actualSize
      sendCommandShortcut(KeyShortcut(characters: "=", keyCode: 24))
    }
  }

  @objc private func shareClicked(_ sender: NSButton) {
    if let orig = findNativeControl(actionName: "share:"), let action = orig.action {
      NSApp.sendAction(action, to: orig.target, from: sender)
      return
    }
    let picker = NSSharingServicePicker(items: urls)
    picker.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
  }

  @objc private func openInPreviewClicked(_ sender: NSButton) {
    if let orig = findNativeControl(actionName: "open:"), let action = orig.action {
      NSApp.sendAction(action, to: orig.target, from: orig)
      return
    }
    for url in urls {
      NSWorkspace.shared.open(url)
    }
    panel?.close()
    NSApp.terminate(nil)
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
