import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "@/i18n";
import { createDraftProject } from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectAdded, projectsSelectors } from "@/store/projectsSlice";
import { KebabIcon, OverflowMenu } from "@/ui/components/OverflowMenu";
import { colors, elevation, radii, spacing } from "@/ui/theme";
import { getTrackColor } from "@/ui/trackColors";

export function LibraryScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { t } = useTranslation();
  const projects = useAppSelector((s) =>
    projectsSelectors.selectAll(s.projects),
  );
  const hydrated = useAppSelector((s) => s.projects.hydrated);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * There is no "new project" screen. Creating one means making an empty
   * project and opening it - the project screen shows a stemless project in
   * edit mode, so creating and editing are literally the same view.
   */
  async function handleNewProject() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const draft = await createDraftProject();
      dispatch(projectAdded(draft));
      router.push({
        pathname: "/project/[projectId]",
        params: { projectId: draft.id },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const menuItems = [
    {
      key: "about",
      label: t.menu.about,
      onPress: () => router.push("/about"),
      testID: "menu-about",
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>VIRTUAL VS</Text>
          <Text style={styles.header}>{t.library.title}</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Press feedback via the `style` callback rather than a
              function-as-child: see ProjectScreen's HeaderButton for why
              re-creating children on press can crash Fabric mid-navigation. */}
          <Pressable
            onPress={handleNewProject}
            disabled={creating}
            hitSlop={8}
            testID="new-project-button"
            style={({ pressed }) => [
              styles.newProjectButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.newProjectText}>{t.library.newProject}</Text>
          </Pressable>
          <OverflowMenu items={menuItems} accessibilityLabel={t.menu.moreOptions} testID="library-menu">
            <KebabIcon />
          </OverflowMenu>
        </View>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        {!hydrated ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : projects.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.library.emptyTitle}</Text>
            <Text style={styles.emptyMeta}>{t.library.emptyMeta}</Text>
          </View>
        ) : (
          projects.map((item, index) => {
            const accentColor = getTrackColor(index);
            return (
              <Pressable
                key={item.id}
                onPress={() =>
                  router.push({
                    pathname: "/project/[projectId]",
                    params: { projectId: item.id },
                  })
                }
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={[styles.colorBar, { backgroundColor: accentColor }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.title}>{item.title}</Text>
                  <View style={styles.metaRow}>
                    {item.bpm !== undefined && (
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>{item.bpm} BPM</Text>
                      </View>
                    )}
                    <View style={styles.metaPill}>
                      <Text style={styles.metaPillText}>{item.key || "—"}</Text>
                    </View>
                    <View style={styles.metaPill}>
                      <Text style={styles.metaPillText}>{t.library.stemsCount(item.tracks.length)}</Text>
                    </View>
                  </View>
                </View>
                {/* No Edit affordance here: opening a project *is* how you
                    edit it now - the project screen carries its own Edit
                    button next to the mixer. */}
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  header: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  newProjectButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: "rgba(32,138,239,0.16)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(32,138,239,0.5)",
  },
  newProjectText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    overflow: "hidden",
    ...elevation,
  },
  colorBar: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 2,
    marginRight: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    gap: 6,
  },
  metaPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  metaPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  editButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginLeft: spacing.sm,
  },
  editButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  chevron: {
    color: colors.textTertiary,
    fontSize: 22,
    fontWeight: "600",
    marginLeft: spacing.sm,
  },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    gap: 6,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyMeta: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  loading: {
    marginTop: 60,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
