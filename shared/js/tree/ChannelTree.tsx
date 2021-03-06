import * as contextmenu from "tc-shared/ui/elements/ContextMenu";
import {MenuEntryType} from "tc-shared/ui/elements/ContextMenu";
import * as log from "tc-shared/log";
import {LogCategory, logWarn} from "tc-shared/log";
import {Settings, settings} from "tc-shared/settings";
import {PermissionType} from "tc-shared/permission/PermissionType";
import {SpecialKey} from "tc-shared/PPTListener";
import {Sound} from "tc-shared/sound/Sounds";
import {Group} from "tc-shared/permission/GroupManager";
import {ServerAddress, ServerEntry} from "./Server";
import {ChannelEntry, ChannelProperties, ChannelSubscribeMode} from "./Channel";
import {ClientEntry, LocalClientEntry, MusicClientEntry} from "./Client";
import {ChannelTreeEntry} from "./ChannelTreeEntry";
import {ConnectionHandler, ViewReasonId} from "tc-shared/ConnectionHandler";
import {createChannelModal} from "tc-shared/ui/modal/ModalCreateChannel";
import {Registry} from "tc-shared/events";
import * as ReactDOM from "react-dom";
import * as React from "react";
import * as ppt from "tc-backend/ppt";

import {batch_updates, BatchUpdateType, flush_batched_updates} from "tc-shared/ui/react-elements/ReactComponentBase";
import {createInputModal} from "tc-shared/ui/elements/Modal";
import {spawnBanClient} from "tc-shared/ui/modal/ModalBanClient";
import {formatMessage} from "tc-shared/ui/frames/chat";
import {spawnYesNo} from "tc-shared/ui/modal/ModalYesNo";
import {tra} from "tc-shared/i18n/localize";
import {EventType} from "tc-shared/ui/frames/log/Definitions";
import {renderChannelTree} from "tc-shared/ui/tree/Controller";
import {ChannelTreePopoutController} from "tc-shared/ui/tree/popout/Controller";

export interface ChannelTreeEvents {
    action_select_entries: {
        entries: ChannelTreeEntry<any>[],
        /**
         * auto      := Select/unselect/add/remove depending on the selected state & shift key state
         * exclusive := Only selected these entries
         * append    := Append these entries to the current selection
         * remove    := Remove these entries from the current selection
         */
        mode: "auto" | "exclusive" | "append" | "remove";
    },

    /* general tree notified */
    notify_tree_reset: {},
    notify_selection_changed: {},
    notify_query_view_state_changed: { queries_shown: boolean },
    notify_popout_state_changed: { popoutShown: boolean },

    notify_entry_move_begin: {},
    notify_entry_move_end: {},

    /* channel tree events */
    notify_channel_created: { channel: ChannelEntry },
    notify_channel_moved: { channel: ChannelEntry },
    notify_channel_deleted: { channel: ChannelEntry },
    notify_channel_client_order_changed: { channel: ChannelEntry },

    notify_channel_updated: {
        channel: ChannelEntry,
        channelProperties: ChannelProperties,
        updatedProperties: ChannelProperties
    },

    notify_channel_list_received: {}

    /* client events */
    notify_client_enter_view: {
        client: ClientEntry,
        reason: ViewReasonId,
        isServerJoin: boolean,
        targetChannel: ChannelEntry
    },
    notify_client_moved: {
        client: ClientEntry,
        oldChannel: ChannelEntry | undefined,
        newChannel: ChannelEntry
    }
    notify_client_leave_view: {
        client: ClientEntry,
        reason: ViewReasonId,
        message?: string,
        isServerLeave: boolean,
        sourceChannel: ChannelEntry
    }
}

export class ChannelTreeEntrySelect {
    readonly handle: ChannelTree;
    selectedEntries: ChannelTreeEntry<any>[] = [];

    private readonly handlerSelectEntries;

    constructor(handle: ChannelTree) {
        this.handle = handle;

        this.handlerSelectEntries = e => {
            batch_updates(BatchUpdateType.CHANNEL_TREE);
            try {
                this.handleSelectEntries(e)
            } finally {
                flush_batched_updates(BatchUpdateType.CHANNEL_TREE);
            }
        };

        this.handle.events.on("action_select_entries", this.handlerSelectEntries);
    }

    reset() {
        this.selectedEntries.splice(0, this.selectedEntries.length);
    }

    destroy() {
        this.handle.events.off("action_select_entries", this.handlerSelectEntries);
        this.selectedEntries.splice(0, this.selectedEntries.length);
    }

    isMultiSelect() {
        return this.selectedEntries.length > 1;
    }

    isAnythingSelected() {
        return this.selectedEntries.length > 0;
    }

    clearSelection() {
        this.handleSelectEntries({
            entries: [],
            mode: "exclusive"
        });
    }

    /**
     * auto      := Select/unselect/add/remove depending on the selected state & shift key state
     * exclusive := Only selected these entries
     * append    := Append these entries to the current selection
     * remove    := Remove these entries from the current selection
     */
    select(entries: ChannelTreeEntry<any>[], mode: "auto" | "exclusive" | "append" | "remove") {
        entries = entries.filter(entry => !!entry);

        if(mode === "exclusive") {
            let deleted_entries = this.selectedEntries;
            let new_entries = [];

            this.selectedEntries = [];
            for(const new_entry of entries) {
                if(!deleted_entries.remove(new_entry)) {
                    new_entries.push(new_entry);
                }

                this.selectedEntries.push(new_entry);
            }

            for(const deleted of deleted_entries) {
                deleted["onUnselect"]();
            }

            for(const new_entry of new_entries) {
                new_entry["onSelect"](!this.isMultiSelect());
            }

            if(deleted_entries.length !== 0 || new_entries.length !== 0) {
                this.handle.events.fire("notify_selection_changed");
            }
        } else if(mode === "append") {
            let new_entries = [];
            for(const entry of entries) {
                if(this.selectedEntries.findIndex(e => e === entry) !== -1)
                    continue;

                this.selectedEntries.push(entry);
                new_entries.push(entry);
            }

            for(const new_entry of new_entries) {
                new_entry["onSelect"](!this.isMultiSelect());
            }

            if(new_entries.length !== 0) {
                this.handle.events.fire("notify_selection_changed");
            }
        } else if(mode === "remove") {
            let deleted_entries = [];
            for(const entry of entries) {
                if(this.selectedEntries.remove(entry)) {
                    deleted_entries.push(entry);
                }
            }

            for(const deleted of deleted_entries) {
                deleted["onUnselect"]();
            }

            if(deleted_entries.length !== 0) {
                this.handle.events.fire("notify_selection_changed");
            }
        } else if(mode === "auto") {
            let deleted_entries = [];
            let new_entries = [];

            if(ppt.key_pressed(SpecialKey.SHIFT)) {
                for(const entry of entries) {
                    const index = this.selectedEntries.findIndex(e => e === entry);
                    if(index === -1) {
                        this.selectedEntries.push(entry);
                        new_entries.push(entry);
                    } else {
                        this.selectedEntries.splice(index, 1);
                        deleted_entries.push(entry);
                    }
                }
            } else {
                deleted_entries = this.selectedEntries.splice(0, this.selectedEntries.length);
                if(entries.length !== 0) {
                    const entry = entries[entries.length - 1];
                    this.selectedEntries.push(entry);
                    if(!deleted_entries.remove(entry))
                        new_entries.push(entry); /* entry wans't selected yet */
                }
            }

            for(const deleted of deleted_entries) {
                deleted["onUnselect"]();
            }

            for(const new_entry of new_entries) {
                new_entry["onSelect"](!this.isMultiSelect());
            }

            if(deleted_entries.length !== 0 || new_entries.length !== 0) {
                this.handle.events.fire("notify_selection_changed");
            }
        } else {
            console.warn("Received entry select event with unknown mode: %s", mode);
        }

        /*
        TODO!
        if(this.selected_entries.length === 1)
            this.handle.view.current?.scrollEntryInView(this.selected_entries[0] as any);
        */
    }

    private selectNextChannel(currentChannel: ChannelEntry, selectClients: boolean) {
        if(selectClients) {
            const clients = currentChannel.channelClientsOrdered();
            if(clients.length > 0) {
                this.select([clients[0]], "exclusive");
                return;
            }
        }

        const children = currentChannel.children();
        if(children.length > 0) {
            this.select([children[0]], "exclusive")
            return;
        }

        const next = currentChannel.channel_next;
        if(next) {
            this.select([next], "exclusive")
            return;
        }

        let parent = currentChannel.parent_channel();
        while(parent) {
            const p_next = parent.channel_next;
            if(p_next) {
                this.select([p_next], "exclusive")
                return;
            }

            parent = parent.parent_channel();
        }
    }

    selectNextTreeEntry() {
        if(this.selectedEntries.length !== 1) { return; }
        const selected = this.selectedEntries[0];

        if(selected instanceof ChannelEntry) {
            this.selectNextChannel(selected, true);
        } else if(selected instanceof ClientEntry){
            const channel = selected.currentChannel();
            const clients = channel.channelClientsOrdered();
            const index = clients.indexOf(selected);
            if(index + 1 < clients.length) {
                this.select([clients[index + 1]], "exclusive");
                return;
            }

            this.selectNextChannel(channel, false);
        } else if(selected instanceof ServerEntry) {
            this.select([this.handle.get_first_channel()], "exclusive");
        }
    }

    selectPreviousTreeEntry() {
        if(this.selectedEntries.length !== 1) { return; }
        const selected = this.selectedEntries[0];

        if(selected instanceof ChannelEntry) {
            let previous = selected.channel_previous;

            if(previous) {
                while(true) {
                    const siblings = previous.children();
                    if(siblings.length == 0) break;
                    previous = siblings.last();
                }
                const clients = previous.channelClientsOrdered();
                if(clients.length > 0) {
                    this.select([ clients.last() ], "exclusive");
                    return;
                } else {
                    this.select([ previous ], "exclusive");
                    return;
                }
            } else if(selected.hasParent()) {
                const channel = selected.parent_channel();
                const clients = channel.channelClientsOrdered();
                if(clients.length > 0) {
                    this.select([ clients.last() ], "exclusive");
                    return;
                } else {
                    this.select([ channel ], "exclusive");
                    return;
                }
            } else {
                this.select([ this.handle.server ], "exclusive");
            }
        } else if(selected instanceof ClientEntry) {
            const channel = selected.currentChannel();
            const clients = channel.channelClientsOrdered();
            const index = clients.indexOf(selected);
            if(index > 0) {
                this.select([ clients[index - 1] ], "exclusive");
                return;
            }
            this.select([ channel ], "exclusive");
            return;
        }
    }

    private handleSelectEntries(event: ChannelTreeEvents["action_select_entries"]) {
        this.select(event.entries, event.mode);
    }
}

export class ChannelTree {
    readonly events: Registry<ChannelTreeEvents>;

    client: ConnectionHandler;
    server: ServerEntry;

    channels: ChannelEntry[] = [];
    clients: ClientEntry[] = [];

    /* whatever all channels have been initialized */
    channelsInitialized: boolean = false;

    readonly selection: ChannelTreeEntrySelect;
    readonly popoutController: ChannelTreePopoutController;

    private readonly tagContainer: JQuery;

    private _show_queries: boolean;
    private channel_last?: ChannelEntry;
    private channel_first?: ChannelEntry;

    constructor(client) {
        this.events = new Registry<ChannelTreeEvents>();
        this.events.enableDebug("channel-tree");

        this.client = client;

        this.server = new ServerEntry(this, "undefined", undefined);
        this.selection = new ChannelTreeEntrySelect(this);
        this.popoutController = new ChannelTreePopoutController(this);

        this.tagContainer = $.spawn("div").addClass("channel-tree-container");
        renderChannelTree(this, this.tagContainer[0], { popoutButton: true });

        this.reset();
    }

    tag_tree() : JQuery {
        return this.tagContainer;
    }

    channelsOrdered() : ChannelEntry[] {
        const result = [];

        const visit = (channel: ChannelEntry) => {
            result.push(channel);
            channel.child_channel_head && visit(channel.child_channel_head);
            channel.channel_next && visit(channel.channel_next);
        };
        this.channel_first && visit(this.channel_first);

        return result;
    }

    findEntryId(entryId: number) : ServerEntry | ChannelEntry | ClientEntry {
        /* TODO: Build a cache and don't iterate over everything */
        if(this.server.uniqueEntryId === entryId) {
            return this.server;
        }

        const channelIndex = this.channels.findIndex(channel => channel.uniqueEntryId === entryId);
        if(channelIndex !== -1) {
            return this.channels[channelIndex];
        }

        const clientIndex = this.clients.findIndex(client => client.uniqueEntryId === entryId);
        if(clientIndex !== -1) {
            return this.clients[clientIndex];
        }

        return undefined;
    }

    destroy() {
        ReactDOM.unmountComponentAtNode(this.tagContainer[0]);

        if(this.server) {
            this.server.destroy();
            this.server = undefined;
        }
        this.reset(); /* cleanup channel and clients */

        this.channel_first = undefined;
        this.channel_last = undefined;

        this.popoutController.destroy();
        this.tagContainer.remove();
        this.selection.destroy();
        this.events.destroy();
    }

    initialiseHead(serverName: string, address: ServerAddress) {
        this.server.reset();
        this.server.remote_address = Object.assign({}, address);
        this.server.properties.virtualserver_name = serverName;
    }

    rootChannel() : ChannelEntry[] {
        const result = [];
        let first = this.channel_first;
        while(first) {
            result.push(first);
            first = first.channel_next;
        }
        return result;
    }

    deleteChannel(channel: ChannelEntry) {
        channel.channelTree = null;

        batch_updates(BatchUpdateType.CHANNEL_TREE);
        try {
            if(!this.channels.remove(channel)) {
                log.warn(LogCategory.CHANNEL, tr("Deleting an unknown channel!"));
            }

            channel.children(false).forEach(e => this.deleteChannel(e));
            if(channel.clients(false).length !== 0) {
                log.warn(LogCategory.CHANNEL, tr("Deleting a non empty channel! This could cause some errors."));
                for(const client of channel.clients(false)) {
                    this.deleteClient(client, { reason: ViewReasonId.VREASON_SYSTEM, serverLeave: false });
                }
            }

            this.unregisterChannelFromTree(channel);
            this.events.fire("notify_channel_deleted", { channel: channel });
        } finally {
            flush_batched_updates(BatchUpdateType.CHANNEL_TREE);
        }
    }

    insertChannel(channel: ChannelEntry, previous: ChannelEntry, parent: ChannelEntry) {
        channel.channelTree = this;
        this.channels.push(channel);

        this.moveChannel(channel, previous, parent, false);
        this.events.fire("notify_channel_created", { channel: channel });
    }

    findChannel(channelId: number) : ChannelEntry | undefined {
        if(typeof channelId === "string") /* legacy fix */
            channelId = parseInt(channelId);

        for(let index = 0; index < this.channels.length; index++)
            if(this.channels[index].channelId === channelId) return this.channels[index];
        return undefined;
    }

    find_channel_by_name(name: string, parent?: ChannelEntry, force_parent: boolean = true) : ChannelEntry | undefined {
        for(let index = 0; index < this.channels.length; index++)
            if(this.channels[index].channelName() == name && (!force_parent || parent == this.channels[index].parent))
                return this.channels[index];
        return undefined;
    }

    private unregisterChannelFromTree(channel: ChannelEntry) {
        if(channel.parent) {
            if(channel.parent.child_channel_head === channel) {
                channel.parent.child_channel_head = channel.channel_next;
            }
        }

        if(channel.channel_previous) {
            channel.channel_previous.channel_next = channel.channel_next;
        }

        if(channel.channel_next) {
            channel.channel_next.channel_previous = channel.channel_previous;
        }

        if(channel === this.channel_last) {
            this.channel_last = channel.channel_previous;
        }

        if(channel === this.channel_first) {
            this.channel_first = channel.channel_next;
        }

        channel.channel_next = undefined;
        channel.channel_previous = undefined;
        channel.parent = undefined;
    }

    moveChannel(channel: ChannelEntry, channelPrevious: ChannelEntry, parent: ChannelEntry, triggerMoveEvent: boolean) {
        if(channelPrevious != null && channelPrevious.parent != parent) {
            console.error(tr("Invalid channel move (different parents! (%o|%o)"), channelPrevious.parent, parent);
            return;
        }

        this.unregisterChannelFromTree(channel);
        channel.channel_previous = channelPrevious;
        channel.channel_next = undefined;
        channel.parent = parent;

        if(channelPrevious) {
            if(channelPrevious == this.channel_last) {
                this.channel_last = channel;
            }

            channel.channel_next = channelPrevious.channel_next;
            channelPrevious.channel_next = channel;

            if(channel.channel_next) {
                channel.channel_next.channel_previous = channel;
            }
        } else {
            if(parent) {
                let children = parent.children();
                parent.child_channel_head = channel;
                if(children.length === 0) { //Self should be already in there
                    channel.channel_next = undefined;
                } else {
                    channel.channel_next = children[0];
                    channel.channel_next.channel_previous = channel;
                }
            } else {
                channel.channel_next = this.channel_first;
                if(this.channel_first)
                    this.channel_first.channel_previous = channel;

                this.channel_first = channel;
                this.channel_last = this.channel_last || channel;
            }
        }

        if(channel.channel_previous == channel) {  /* shall never happen */
            channel.channel_previous = undefined;
            debugger;
        }
        if(channel.channel_next == channel) {  /* shall never happen */
            channel.channel_next = undefined;
            debugger;
        }

        if(triggerMoveEvent) {
            this.events.fire("notify_channel_moved", { channel: channel });
        }
    }

    deleteClient(client: ClientEntry, reason: { reason: ViewReasonId, message?: string, serverLeave: boolean }) {
        const oldChannel = client.currentChannel();
        oldChannel?.unregisterClient(client);
        this.clients.remove(client);

        if(oldChannel) {
            this.events.fire("notify_client_leave_view", { client: client, message: reason.message, reason: reason.reason, isServerLeave: reason.serverLeave, sourceChannel: oldChannel });
            this.client.side_bar.info_frame().update_channel_client_count(oldChannel);
        } else {
            logWarn(LogCategory.CHANNEL, tr("Deleting client %s from channel tree which hasn't a channel."), client.clientId());
        }

        const voice_connection = this.client.serverConnection.getVoiceConnection();
        if(client.getVoiceClient()) {
            const voiceClient = client.getVoiceClient();
            client.setVoiceClient(undefined);

            if(!voice_connection) {
                log.warn(LogCategory.VOICE, tr("Deleting client with a voice handle, but we haven't a voice connection!"));
            } else {
                voice_connection.unregisterVoiceClient(voiceClient);
            }
        }
        client.destroy();
    }

    registerClient(client: ClientEntry) {
        this.clients.push(client);
        client.channelTree = this;

        const voiceConnection = this.client.serverConnection.getVoiceConnection();
        if(voiceConnection) {
            client.setVoiceClient(voiceConnection.registerVoiceClient(client.clientId()));
        }
    }

    unregisterClient(client: ClientEntry) {
        if(!this.clients.remove(client))
            return;
    }

    insertClient(client: ClientEntry, channel: ChannelEntry, reason: { reason: ViewReasonId, isServerJoin: boolean }) : ClientEntry {
        batch_updates(BatchUpdateType.CHANNEL_TREE);
        try {
            let newClient = this.findClient(client.clientId());
            if(newClient)
                client = newClient; //Got new client :)
            else {
                this.registerClient(client);
            }

            client.currentChannel()?.unregisterClient(client);
            client["_channel"] = channel;
            channel.registerClient(client);

            this.events.fire("notify_client_enter_view", { client: client, reason: reason.reason, isServerJoin: reason.isServerJoin, targetChannel: channel });
            return client;
        } finally {
            flush_batched_updates(BatchUpdateType.CHANNEL_TREE);
        }
    }

    moveClient(client: ClientEntry, targetChannel: ChannelEntry) {
        batch_updates(BatchUpdateType.CHANNEL_TREE);
        try {
            let oldChannel = client.currentChannel();
            oldChannel?.unregisterClient(client);
            client["_channel"] = targetChannel;
            targetChannel?.registerClient(client);

            if(oldChannel) {
                this.client.side_bar.info_frame().update_channel_client_count(oldChannel);
            }

            if(targetChannel) {
                this.client.side_bar.info_frame().update_channel_client_count(targetChannel);
            }

            this.events.fire("notify_client_moved", { oldChannel: oldChannel, newChannel: targetChannel, client: client });
        } finally {
            flush_batched_updates(BatchUpdateType.CHANNEL_TREE);
        }
    }

    findClient?(clientId: number) : ClientEntry {
        for(let index = 0; index < this.clients.length; index++) {
            if(this.clients[index].clientId() == clientId)
                return this.clients[index];
        }
        return undefined;
    }

    find_client_by_dbid?(client_dbid: number) : ClientEntry {
        for(let index = 0; index < this.clients.length; index++) {
            if(this.clients[index].properties.client_database_id == client_dbid)
                return this.clients[index];
        }
        return undefined;
    }

    find_client_by_unique_id?(unique_id: string) : ClientEntry {
        for(let index = 0; index < this.clients.length; index++) {
            if(this.clients[index].properties.client_unique_identifier == unique_id)
                return this.clients[index];
        }
        return undefined;
    }

    showContextMenu(x: number, y: number, on_close: () => void = undefined) {
        let channelCreate =
            this.client.permissions.neededPermission(PermissionType.B_CHANNEL_CREATE_TEMPORARY).granted(1) ||
            this.client.permissions.neededPermission(PermissionType.B_CHANNEL_CREATE_SEMI_PERMANENT).granted(1) ||
            this.client.permissions.neededPermission(PermissionType.B_CHANNEL_CREATE_PERMANENT).granted(1);

        contextmenu.spawn_context_menu(x, y,
            {
                type: contextmenu.MenuEntryType.ENTRY,
                icon_class: "client-channel_create",
                name: tr("Create channel"),
                invalidPermission: !channelCreate,
                callback: () => this.spawnCreateChannel()
            },
            contextmenu.Entry.HR(),
            {
                type: contextmenu.MenuEntryType.ENTRY,
                icon_class: "client-channel_collapse_all",
                name: tr("Collapse all channels"),
                callback: () => this.collapse_channels()
            },
            {
                type: contextmenu.MenuEntryType.ENTRY,
                icon_class: "client-channel_expand_all",
                name: tr("Expend all channels"),
                callback: () => this.expand_channels()
            },
            contextmenu.Entry.CLOSE(on_close)
        );
    }

    public open_multiselect_context_menu(entries: ChannelTreeEntry<any>[], x: number, y: number) {
        const clients = entries.filter(e => e instanceof ClientEntry) as ClientEntry[];
        const channels = entries.filter(e => e instanceof ChannelEntry) as ChannelEntry[];
        const server = entries.find(e => e instanceof ServerEntry) as ServerEntry;

        let client_menu: contextmenu.MenuEntry[];
        let channel_menu: contextmenu.MenuEntry[];
        let server_menu: contextmenu.MenuEntry[];

        if(clients.length > 0) {
            client_menu = [];

            const music_only = clients.map(e => e instanceof MusicClientEntry ? 0 : 1).reduce((a, b) => a + b, 0) == 0;
            const music_entry = clients.map(e => e instanceof MusicClientEntry ? 1 : 0).reduce((a, b) => a + b, 0) > 0;
            const local_client = clients.map(e => e instanceof LocalClientEntry ? 1 : 0).reduce((a, b) => a + b, 0) > 0;

            if (!music_entry && !local_client) { //Music bots or local client cant be poked
                client_menu.push({
                    type: contextmenu.MenuEntryType.ENTRY,
                    icon_class: "client-poke",
                    name: tr("Poke clients"),
                    callback: () => {
                        createInputModal(tr("Poke clients"), tr("Poke message:<br>"), text => true, result => {
                            if (typeof(result) === "string") {
                                for (const client of clients)
                                    this.client.serverConnection.send_command("clientpoke", {
                                        clid: client.clientId(),
                                        msg: result
                                    });

                                this.selection.clearSelection();
                            }
                        }, {width: 400, maxLength: 512}).open();
                    }
                });
            }
            client_menu.push({
                type: contextmenu.MenuEntryType.ENTRY,
                icon_class: "client-move_client_to_own_channel",
                name: tr("Move clients to your channel"),
                callback: () => {
                    const target = this.client.getClient().currentChannel().getChannelId();
                    for(const client of clients)
                        this.client.serverConnection.send_command("clientmove", {
                            clid: client.clientId(),
                            cid: target
                        });
                    this.selection.clearSelection();
                }
            });
            if (!local_client) {//local client cant be kicked and/or banned or kicked
                client_menu.push(contextmenu.Entry.HR());
                client_menu.push({
                    type: contextmenu.MenuEntryType.ENTRY,
                    icon_class: "client-kick_channel",
                    name: tr("Kick clients from channel"),
                    callback: () => {
                        createInputModal(tr("Kick clients from channel"), tr("Kick reason:<br>"), text => true, result => {
                            if (result) {
                                for (const client of clients)
                                    this.client.serverConnection.send_command("clientkick", {
                                        clid: client.clientId(),
                                        reasonid: ViewReasonId.VREASON_CHANNEL_KICK,
                                        reasonmsg: result
                                    });
                            }
                        }, {width: 400, maxLength: 255}).open();
                        this.selection.clearSelection();
                    }
                });

                if (!music_entry) { //Music bots  cant be poked, banned or kicked
                    client_menu.push({
                        type: contextmenu.MenuEntryType.ENTRY,
                        icon_class: "client-poke",
                        name: tr("Poke clients"),
                        callback: () => {
                            this.selection.clearSelection();
                            createInputModal(tr("Poke clients"), tr("Poke message:<br>"), text => true, result => {
                                if (result) {
                                    const elements = clients.map(e => { return { clid: e.clientId() } as any });
                                    elements[0].msg = result;
                                    this.client.serverConnection.send_command("clientpoke", elements);
                                }
                            }, {width: 400, maxLength: 255}).open();
                        }
                    }, {
                        type: contextmenu.MenuEntryType.ENTRY,
                        icon_class: "client-kick_server",
                        name: tr("Kick clients fom server"),
                        callback: () => {
                            this.selection.clearSelection();
                            createInputModal(tr("Kick clients from server"), tr("Kick reason:<br>"), text => true, result => {
                                if (result) {
                                    for (const client of clients)
                                        this.client.serverConnection.send_command("clientkick", {
                                            clid: client.clientId(),
                                            reasonid: ViewReasonId.VREASON_SERVER_KICK,
                                            reasonmsg: result
                                        });
                                }
                            }, {width: 400, maxLength: 255}).open();
                        }
                    }, {
                        type: contextmenu.MenuEntryType.ENTRY,
                        icon_class: "client-ban_client",
                        name: tr("Ban clients"),
                        invalidPermission: !this.client.permissions.neededPermission(PermissionType.I_CLIENT_BAN_MAX_BANTIME).granted(1),
                        callback: () => {
                            this.selection.clearSelection();
                            spawnBanClient(this.client, (clients).map(entry => {
                                return {
                                    name: entry.clientNickName(),
                                    unique_id: entry.properties.client_unique_identifier
                                }
                            }), (data) => {
                                for (const client of clients)
                                    this.client.serverConnection.send_command("banclient", {
                                        uid: client.properties.client_unique_identifier,
                                        banreason: data.reason,
                                        time: data.length
                                    }, {
                                        flagset: [data.no_ip ? "no-ip" : "", data.no_hwid ? "no-hardware-id" : "", data.no_name ? "no-nickname" : ""]
                                    }).then(() => {
                                        this.client.sound.play(Sound.USER_BANNED);
                                    });
                            });
                        }
                    });
                }
                if(music_only) {
                    client_menu.push(contextmenu.Entry.HR());
                    client_menu.push({
                        name: tr("Delete bots"),
                        icon_class: "client-delete",
                        disabled: false,
                        callback: () => {
                            const param_string = clients.map((_, index) => "{" + index + "}").join(', ');
                            const param_values = clients.map(client => client.createChatTag(true));
                            const tag = $.spawn("div").append(...formatMessage(tr("Do you really want to delete ") + param_string, ...param_values));
                            const tag_container = $.spawn("div").append(tag);
                            spawnYesNo(tr("Are you sure?"), tag_container, result => {
                                if(result) {
                                    for(const client of clients)
                                        this.client.serverConnection.send_command("musicbotdelete", {
                                            botid: client.properties.client_database_id
                                        });
                                    this.selection.clearSelection();
                                }
                            });
                        },
                        type: contextmenu.MenuEntryType.ENTRY
                    });
                }
            }
        }
        if(channels.length > 0) {
            channel_menu = [];

            //TODO: Subscribe mode settings
            channel_menu.push({
                type: MenuEntryType.ENTRY,
                name: tr("Delete all channels"),
                icon_class: "client-delete",
                callback: () => {
                    spawnYesNo(tr("Are you sure?"), tra("Do you really want to delete {0} channels?", channels.length), result => {
                        if(typeof result === "boolean" && result) {
                            for(const channel of channels)
                                this.client.serverConnection.send_command("channeldelete", { cid: channel.channelId });
                            this.selection.clearSelection();
                        }
                    });
                }
            });
        }
        if(server)
            server_menu = server.contextMenuItems();

        const menus = [
            {
                text: tr("Apply to all clients"),
                menu: client_menu,
                icon: "client-user-account"
            },
            {
                text: tr("Apply to all channels"),
                menu: channel_menu,
                icon: "client-channel_green"
            },
            {
                text: tr("Server actions"),
                menu: server_menu,
                icon: "client-server_green"
            }
        ].filter(e => !!e.menu);
        if(menus.length === 1) {
            contextmenu.spawn_context_menu(x, y, ...menus[0].menu);
        } else {
            contextmenu.spawn_context_menu(x, y, ...menus.map(e => {
                return {
                    icon_class: e.icon,
                    name: e.text,
                    type: MenuEntryType.SUB_MENU,
                    sub_menu: e.menu
                } as contextmenu.MenuEntry
            }));
        }
    }

    clientsByGroup(group: Group) : ClientEntry[] {
        let result = [];

        for(let client of this.clients) {
            if(client.groupAssigned(group))
                result.push(client);
        }

        return result;
    }

    clientsByChannel(channel: ChannelEntry) : ClientEntry[] {
        let result = [];

        for(let client of this.clients) {
            if(client.currentChannel() == channel)
                result.push(client);
        }

        return result;
    }

    reset() {
        this.channelsInitialized = false;
        batch_updates(BatchUpdateType.CHANNEL_TREE);

        this.selection.clearSelection();
        try {
            this.selection.reset();

            const voice_connection = this.client.serverConnection ? this.client.serverConnection.getVoiceConnection() : undefined;
            for(const client of this.clients) {
                if(client.getVoiceClient() && voice_connection) {
                    voice_connection.unregisterVoiceClient(client.getVoiceClient());
                    client.setVoiceClient(undefined);
                }
                client.destroy();
            }
            this.clients = [];

            for(const channel of this.channels)
                channel.destroy();

            this.channels = [];
            this.channel_last = undefined;
            this.channel_first = undefined;
            this.events.fire("notify_tree_reset");
        } finally {
            flush_batched_updates(BatchUpdateType.CHANNEL_TREE);
        }
    }

    spawnCreateChannel(parent?: ChannelEntry) {
        createChannelModal(this.client, undefined, parent, this.client.permissions, (properties?, permissions?) => {
            if(!properties) return;
            properties["cpid"] = parent ? parent.channelId : 0;
            log.debug(LogCategory.CHANNEL, tr("Creating a new channel.\nProperties: %o\nPermissions: %o"), properties);
            this.client.serverConnection.send_command("channelcreate", properties).then(() => {
                let channel = this.find_channel_by_name(properties.channel_name, parent, true);
                if(!channel) {
                    log.error(LogCategory.CHANNEL, tr("Failed to resolve channel after creation. Could not apply permissions!"));
                    return;
                }
                if(permissions && permissions.length > 0) {
                    let perms = [];
                    for(let perm of permissions) {
                        perms.push({
                            permvalue: perm.value,
                            permnegated: false,
                            permskip: false,
                            permid: perm.type.id
                        });
                    }

                    perms[0]["cid"] = channel.channelId;
                    return this.client.serverConnection.send_command("channeladdperm", perms, {
                        flagset: ["continueonerror"]
                    }).then(() => new Promise<ChannelEntry>(resolve => { resolve(channel); }));
                }

                return new Promise<ChannelEntry>(resolve => { resolve(channel); })
            }).then(channel => {
                this.client.log.log(EventType.CHANNEL_CREATE_OWN, {
                    channel: channel.log_data(),
                    creator: this.client.getClient().log_data(),
                });
                this.client.sound.play(Sound.CHANNEL_CREATED);
            });
        });
    }

    toggle_server_queries(flag: boolean) {
        if(this._show_queries == flag) return;
        this._show_queries = flag;

        this.events.fire("notify_query_view_state_changed", { queries_shown: flag });
    }
    areServerQueriesShown() { return this._show_queries; }

    get_first_channel?() : ChannelEntry {
        return this.channel_first;
    }

    unsubscribe_all_channels(subscribe_specified?: boolean) {
        if(!this.client.serverConnection || !this.client.serverConnection.connected())
            return;

        this.client.serverConnection.send_command('channelunsubscribeall').then(() => {
            const channels: number[] = [];
            for(const channel of this.channels) {
                if(channel.subscribe_mode == ChannelSubscribeMode.SUBSCRIBED)
                    channels.push(channel.getChannelId());
            }

            if(channels.length > 0) {
                this.client.serverConnection.send_command('channelsubscribe', channels.map(e => { return {cid: e}; })).catch(error => {
                    console.warn(tr("Failed to subscribe to specific channels (%o): %o"), channels, error);
                });
            }
        }).catch(error => {
            console.warn(tr("Failed to unsubscribe to all channels! (%o)"), error);
        });
    }

    subscribe_all_channels() {
        if(!this.client.serverConnection || !this.client.serverConnection.connected())
            return;

        this.client.serverConnection.send_command('channelsubscribeall').then(() => {
            const channels: number[] = [];
            for(const channel of this.channels) {
                if(channel.subscribe_mode == ChannelSubscribeMode.UNSUBSCRIBED)
                    channels.push(channel.getChannelId());
            }

            if(channels.length > 0) {
                this.client.serverConnection.send_command('channelunsubscribe', channels.map(e => { return {cid: e}; })).catch(error => {
                    console.warn(tr("Failed to unsubscribe to specific channels (%o): %o"), channels, error);
                });
            }
        }).catch(error => {
            console.warn(tr("Failed to subscribe to all channels! (%o)"), error);
        });
    }

    expand_channels(root?: ChannelEntry) {
        if(typeof root === "undefined")
            this.rootChannel().forEach(e => this.expand_channels(e));
        else {
            root.collapsed = false;
            for(const child of root.children(false))
                this.expand_channels(child);
        }
    }

    collapse_channels(root?: ChannelEntry) {
        if(typeof root === "undefined")
            this.rootChannel().forEach(e => this.collapse_channels(e));
        else {
            root.collapsed = true;
            for(const child of root.children(false))
                this.collapse_channels(child);
        }
    }
}