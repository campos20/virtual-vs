import { getDemoLibraryEntry } from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { projectAdded, projectsSelectors } from "@/store/projectsSlice";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
        <Text style={styles.header}>Library</Text>
        <Pressable
          onPress={() => router.push("/new-project")}
          hitSlop={8}
          testID="new-project-button"
        >
          <Text style={styles.newProjectText}>+ New</Text>
        </Pressable>
      </View>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() =>
              router.push({
                pathname: "/player/[projectId]",
                params: { projectId: item.id },
              })
            }
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.bpm} bpm · {item.key} · {item.tracks.length} stems
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.meta}>No projects yet.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  header: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "700",
  },
  newProjectText: {
    color: "#208AEF",
    fontSize: 16,
    fontWeight: "600",
  },
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
  row: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#1c1c1e",
  },
  title: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  meta: {
    color: "#9b9b9d",
    fontSize: 13,
    marginTop: 4,
  },
});
