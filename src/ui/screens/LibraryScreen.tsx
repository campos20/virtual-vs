import { useRouter } from "expo-router";
import { useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDemoLibraryEntry } from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectAdded, projectsSelectors } from "@/store/projectsSlice";
import { colors, elevation, radii, spacing } from "@/ui/theme";
import { getTrackColor } from "@/ui/trackColors";

export function LibraryScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const projects = useAppSelector((s) =>
    projectsSelectors.selectAll(s.projects),
  );

  useEffect(() => {
    // Seed the bundled demo project on first launch so there's always
    // something to open - see AGENTS.md phase 1 requirements.
    if (projects.length === 0) {
      dispatch(projectAdded(getDemoLibraryEntry()));
    }
  }, [projects.length, dispatch]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>VIRTUAL VS</Text>
          <Text style={styles.header}>Library</Text>
        </View>
        <Pressable
          onPress={() => router.push("/new-project")}
          hitSlop={8}
          testID="new-project-button"
        >
          {({ pressed }) => (
            <View style={[styles.newProjectButton, pressed && styles.pressed]}>
              <Text style={styles.newProjectText}>+ New</Text>
            </View>
          )}
        </Pressable>
      </View>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const accentColor = getTrackColor(index);
          return (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/player/[projectId]",
                  params: { projectId: item.id },
                })
              }
            >
              {({ pressed }) => (
                <View style={[styles.row, pressed && styles.pressed]}>
                  <View style={[styles.colorBar, { backgroundColor: accentColor }]} />
                  <View style={styles.rowBody}>
                    <Text style={styles.title}>{item.title}</Text>
                    <View style={styles.metaRow}>
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>{item.bpm} BPM</Text>
                      </View>
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>{item.key || "—"}</Text>
                      </View>
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>
                          {item.tracks.length} stem{item.tracks.length === 1 ? "" : "s"}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {item.origin === "filesystem" && (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/edit-project/[projectId]",
                          params: { projectId: item.id },
                        })
                      }
                      hitSlop={8}
                      style={styles.editButton}
                      testID={`edit-project-${item.id}`}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyMeta}>Tap “+ New” to import stems and build one.</Text>
          </View>
        }
      />
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
});
