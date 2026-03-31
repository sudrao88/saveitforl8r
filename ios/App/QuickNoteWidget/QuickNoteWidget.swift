import WidgetKit
import SwiftUI

// MARK: - Design Tokens

private enum WidgetColors {
    static let surfaceRaised = Color(red: 0.122, green: 0.161, blue: 0.216) // #1F2937
    static let surfaceInput  = Color(red: 0.067, green: 0.094, blue: 0.153) // #111827
    static let textPrimary   = Color(red: 0.953, green: 0.957, blue: 0.965) // #F3F4F6
    static let textSecondary = Color(red: 0.612, green: 0.639, blue: 0.686) // #9CA3AF
    static let accent        = Color(red: 0.145, green: 0.388, blue: 0.922) // #2563EB
}

private enum DeepLinks {
    static let openApp   = URL(string: "com.saveitforl8r.app://open")!
    static let quickNote = URL(string: "com.saveitforl8r.app://quick-note")!
    static let camera    = URL(string: "com.saveitforl8r.app://quick-note?mode=camera")!
    static let document  = URL(string: "com.saveitforl8r.app://quick-note?mode=document")!
    static let search    = URL(string: "com.saveitforl8r.app://search")!
}

// MARK: - Timeline Provider

struct QuickNoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickNoteEntry {
        QuickNoteEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickNoteEntry) -> Void) {
        completion(QuickNoteEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickNoteEntry>) -> Void) {
        // Static widget — no data to refresh. Set a far-future reload.
        let entry = QuickNoteEntry(date: Date())
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

// MARK: - Timeline Entry

struct QuickNoteEntry: TimelineEntry {
    let date: Date
}

// MARK: - Widget View

struct QuickNoteWidgetView: View {
    var entry: QuickNoteProvider.Entry

    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            smallWidget
        case .systemMedium:
            mediumWidget
        case .accessoryRectangular:
            lockScreenWidget
        default:
            mediumWidget
        }
    }

    // MARK: - Small Widget (2x2)
    // Clean 2x2 grid: App logo, Note, Camera, Document
    private var smallWidget: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                // App logo — opens app
                Link(destination: DeepLinks.openApp) {
                    Image("WidgetIcon")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 28, height: 28)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }

                // Note — focus quick note
                Link(destination: DeepLinks.quickNote) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }
            }

            HStack(spacing: 12) {
                // Camera — open image capture
                Link(destination: DeepLinks.camera) {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }

                // Document — open file picker
                Link(destination: DeepLinks.document) {
                    Image(systemName: "doc.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }
            }
        }
        .padding(16)
        .containerBackground(for: .widget) {
            WidgetColors.surfaceRaised
        }
    }

    // MARK: - Medium Widget (4x2)
    // Text bar on top, 4 action buttons below
    private var mediumWidget: some View {
        VStack(spacing: 12) {
            // Tappable text bar — opens quick note
            Link(destination: DeepLinks.quickNote) {
                HStack(spacing: 10) {
                    Image("WidgetIcon")
                        .resizable()
                        .frame(width: 24, height: 24)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text("Save a thought…")
                        .font(.system(size: 15))
                        .foregroundColor(WidgetColors.textSecondary)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(WidgetColors.surfaceInput)
                .clipShape(RoundedRectangle(cornerRadius: 22))
            }

            // 4 action buttons
            HStack(spacing: 0) {
                // App logo — open home
                Link(destination: DeepLinks.openApp) {
                    Image("WidgetIcon")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 22, height: 22)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }

                Spacer()

                // Camera — image capture
                Link(destination: DeepLinks.camera) {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 17))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }

                Spacer()

                // Search — open chat interface
                Link(destination: DeepLinks.search) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }

                Spacer()

                // Document — file picker
                Link(destination: DeepLinks.document) {
                    Image(systemName: "doc.fill")
                        .font(.system(size: 17))
                        .foregroundColor(WidgetColors.textPrimary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(WidgetColors.surfaceInput)
                        .clipShape(Circle())
                }
            }
        }
        .padding(16)
        .containerBackground(for: .widget) {
            WidgetColors.surfaceRaised
        }
    }

    // MARK: - Lock Screen Widget
    private var lockScreenWidget: some View {
        Link(destination: DeepLinks.quickNote) {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 14, weight: .medium))
                Text("Quick Note")
                    .font(.system(size: 13, weight: .semibold))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .containerBackground(for: .widget) {
            Color.clear
        }
    }
}

// MARK: - Widget Configuration

@main
struct QuickNoteWidgetBundle: Widget {
    let kind: String = "QuickNoteWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickNoteProvider()) { entry in
            QuickNoteWidgetView(entry: entry)
        }
        .configurationDisplayName("Quick Note")
        .description("Quickly save a thought to SaveItForL8r")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - Previews

#if DEBUG
struct QuickNoteWidget_Previews: PreviewProvider {
    static var previews: some View {
        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .systemMedium))

        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .systemSmall))

        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .accessoryRectangular))
    }
}
#endif
