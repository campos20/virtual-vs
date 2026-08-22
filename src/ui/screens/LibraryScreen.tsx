import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "@/i18n";
import { useNowPlaying } from "@/hooks/useNowPlaying";
import { createDraftProject } from "@/storage";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addSongToFolder,
  createFolder,
  deleteFolder,
  persistLibraryOrder,
  removeSongFromFolder,
  renameFolder,
  reorderFolderSongs,
} from "@/store/persistFolders";
import { projectAdded, projectsSelectors } from "@/store/projectsSlice";
import { setlistsSelectors } from "@/store/setlistsSlice";
import { FolderRow } from "@/ui/components/FolderRow";
import { KebabIcon, OverflowMenu, type OverflowMenuItem } from "@/ui/components/OverflowMenu";
import { ProjectRow } from "@/ui/components/ProjectRow";
import { buildLibraryTree } from "@/ui/libraryTree";
import { moveId } from "@/ui/reorder";
import { colors, radii, spacing } from "@/ui/theme";
import { getTrackColor } from "@/ui/trackColors";

export function LibraryScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { t } = useTranslation();
  const projects = useAppSelector((s) =>
    projectsSelectors.selectAll(s.projects),
  );
  const folders = useAppSelector((s) => setlistsSelectors.selectAll(s.setlists));
  const libraryOrder = useAppSelector((s) => s.settings.libraryOrder);
  // Folders are only grouping, so the Library is usable before they arrive -
  // it waits on the projects scan alone, as it always has.
  const hydrated = useAppSelector((s) => s.projects.hydrated);
  const nowPlayingProjectId = useNowPlaying().projectId;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Collapsed folder ids, so the default is *expanded*: a folder hides the
   * songs it holds, and someone opening the Library mid-set needs to see
   * their songs without first remembering which folder each one is in.
   */
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  const items = useMemo(
    () => buildLibraryTree(projects, folders, libraryOrder),
    [projects, folders, libraryOrder],
  );

  /** Reorders the top level - folders and loose songs share one list, so one handler covers both. */
  function handleMove(index: number, direction: "up" | "down") {
    const keys = items.map((item) => item.key);
    const reordered = moveId(keys, index, direction);
    if (reordered !== keys) dispatch(persistLibraryOrder(reordered));
  }

  /** Reorders songs within one folder, which is stored in that folder's own manifest. */
  function handleMoveInFolder(
    folderId: string,
    songIds: string[],
    index: number,
    direction: "up" | "down",
  ) {
    const reordered = moveId(songIds, index, direction);
    if (reordered !== songIds) dispatch(reorderFolderSongs(folderId, reordered));
  }

  function handleNewFolder() {
    const folder = dispatch(createFolder(t.folder.defaultName));
    // Straight into rename: a folder called "New folder" is never what the
    // user meant, and this saves them hunting for the menu to fix it.
    setRenamingFolderId(folder.id);
  }

  function handleRenameSubmit(folderId: string, name: string) {
    setRenamingFolderId(null);
    const trimmed = name.trim();
    if (trimmed) dispatch(renameFolder(folderId, trimmed));
  }

  function handleDeleteFolder(folderId: string, name: string, songCount: number) {
    Alert.alert(
      t.folder.deleteConfirmTitle,
      t.folder.deleteConfirmBody(name, songCount),
      [
        { text: t.common.cancel, style: "cancel" },
        {
          text: t.folder.deleteConfirmConfirm,
          style: "destructive",
          onPress: () => dispatch(deleteFolder(folderId)),
        },
      ],
    );
  }

  /**
   * A song's menu: which folders it can be added to, and - when it's shown
   * inside one - a way back out. Empty for a song when there are no folders
   * yet, which is what suppresses the kebab entirely.
   */
  function songMenuItems(projectId: string, containingFolderId?: string): OverflowMenuItem[] {
    const additions = folders
      .filter((folder) => !folder.songs.includes(projectId))
      .map((folder) => ({
        key: `add-${folder.id}`,
        label: t.folder.addTo(folder.name),
        onPress: () => dispatch(addSongToFolder(folder.id, projectId)),
        testID: `add-to-folder-${folder.id}`,
      }));

    if (!containingFolderId) return additions;

    return [
      ...additions,
      {
        key: "remove",
        label: t.folder.removeFrom,
        onPress: () => dispatch(removeSongFromFolder(containingFolderId, projectId)),
        testID: `remove-from-folder-${containingFolderId}`,
      },
    ];
  }

  function openProject(projectId: string) {
    router.push({
      pathname: "/project/[projectId]",
      params: { projectId },
    });
  }

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
            onPress={handleNewFolder}
            hitSlop={8}
            testID="new-folder-button"
            style={({ pressed }) => [styles.newFolderButton, pressed && styles.pressed]}
          >
            <Text style={styles.newFolderText}>{t.library.newFolder}</Text>
          </Pressable>
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
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t.library.emptyTitle}</Text>
            <Text style={styles.emptyMeta}>{t.library.emptyMeta}</Text>
          </View>
        ) : (
          items.map((item, index) => {
            const accentColor = getTrackColor(index);
            const canMoveUp = index > 0;
            const canMoveDown = index < items.length - 1;

            if (item.kind === "folder") {
              const { folder, songs } = item;
              const expanded = !collapsed.includes(folder.id);
              return (
                <View key={item.key} style={styles.folderGroup}>
                  <FolderRow
                    testID={`folder-row-${folder.id}`}
                    name={folder.name}
                    songsLabel={t.folder.songsCount(songs.length)}
                    expanded={expanded}
                    onToggle={() =>
                      setCollapsed((current) =>
                        current.includes(folder.id)
                          ? current.filter((id) => id !== folder.id)
                          : [...current, folder.id],
                      )
                    }
                    expandAccessibilityLabel={expanded ? t.folder.collapse : t.folder.expand}
                    menuAccessibilityLabel={t.folder.folderOptions}
                    menuItems={[
                      {
                        key: "rename",
                        label: t.folder.rename,
                        onPress: () => setRenamingFolderId(folder.id),
                        testID: `rename-folder-${folder.id}`,
                      },
                      {
                        key: "delete",
                        label: t.folder.delete,
                        onPress: () =>
                          handleDeleteFolder(folder.id, folder.name, songs.length),
                        testID: `delete-folder-${folder.id}`,
                      },
                    ]}
                    renaming={renamingFolderId === folder.id}
                    renamePlaceholder={t.folder.renamePlaceholder}
                    onRenameSubmit={(name) => handleRenameSubmit(folder.id, name)}
                    onRenameCancel={() => setRenamingFolderId(null)}
                    canMoveUp={canMoveUp}
                    canMoveDown={canMoveDown}
                    onMoveUp={() => handleMove(index, "up")}
                    onMoveDown={() => handleMove(index, "down")}
                    moveUpAccessibilityLabel={t.library.moveUp}
                    moveDownAccessibilityLabel={t.library.moveDown}
                  />
                  {expanded &&
                    (songs.length === 0 ? (
                      <Text style={styles.folderEmpty}>{t.folder.empty}</Text>
                    ) : (
                      songs.map((song, songIndex) => (
                        <ProjectRow
                          key={song.id}
                          testID={`project-row-${song.id}`}
                          nested
                          title={song.title}
                          bpm={song.bpm}
                          musicalKey={song.key}
                          accentColor={getTrackColor(songIndex)}
                          stemsLabel={t.library.stemsCount(song.tracks.length)}
                          canMoveUp={songIndex > 0}
                          canMoveDown={songIndex < songs.length - 1}
                          moveUpAccessibilityLabel={t.library.moveUp}
                          moveDownAccessibilityLabel={t.library.moveDown}
                          isNowPlaying={song.id === nowPlayingProjectId}
                          nowPlayingAccessibilityLabel={t.nowPlaying.heading}
                          menuItems={songMenuItems(song.id, folder.id)}
                          menuAccessibilityLabel={t.folder.songOptions}
                          onPress={() => openProject(song.id)}
                          onMoveUp={() =>
                            handleMoveInFolder(
                              folder.id,
                              songs.map((s) => s.id),
                              songIndex,
                              "up",
                            )
                          }
                          onMoveDown={() =>
                            handleMoveInFolder(
                              folder.id,
                              songs.map((s) => s.id),
                              songIndex,
                              "down",
                            )
                          }
                        />
                      ))
                    ))}
                </View>
              );
            }

            const project = item.project;
            return (
              <ProjectRow
                key={item.key}
                testID={`project-row-${project.id}`}
                title={project.title}
                bpm={project.bpm}
                musicalKey={project.key}
                accentColor={accentColor}
                stemsLabel={t.library.stemsCount(project.tracks.length)}
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
                moveUpAccessibilityLabel={t.library.moveUp}
                moveDownAccessibilityLabel={t.library.moveDown}
                isNowPlaying={project.id === nowPlayingProjectId}
                nowPlayingAccessibilityLabel={t.nowPlaying.heading}
                menuItems={songMenuItems(project.id)}
                menuAccessibilityLabel={t.folder.songOptions}
                onPress={() => openProject(project.id)}
                onMoveUp={() => handleMove(index, "up")}
                onMoveDown={() => handleMove(index, "down")}
              />
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
  newFolderButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  newFolderText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: "700",
  },
  folderGroup: {
    gap: spacing.sm,
  },
  folderEmpty: {
    color: colors.textTertiary,
    fontSize: 13,
    marginLeft: spacing.lg,
    marginBottom: spacing.xs,
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
