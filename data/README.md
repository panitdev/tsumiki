# Minecraft Java 26.3 block catalog

`blocks.json` preserves the allowed properties and default state for all 1,286 blocks in the Java 26.3 block report. The report was generated with Java 25 from the server jar in the [Mojang version manifest](https://piston-meta.mojang.com/v1/packages/ead839cbccf0ddf013c3f935f2840080b5cb0d26/26.3.json) using `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`.

Colors are the default states' in-game map colors. Turn tables are deduplicated from the game's block-state transformations, indexed by the Cartesian product of the listed property values. The three indices refer to a clockwise quarter turn, an X reflection, and a Z reflection. An index of `-1` represents an unchanged state. Reflections swap the handedness of shaped stairs, double chests, and chained shelves so those states can be mirrored without a live world.

`placement-items.json` records the same release's block-to-item mappings from the block registry and `Block.asItem()`. A null mapping means the block has no placement item in that registry. Stack sizes come from `minecraft:max_stack_size` in the generated item component reports. The file omits identity mappings and stack sizes of 64.
