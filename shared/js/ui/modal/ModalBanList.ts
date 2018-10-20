namespace Modals {
    export interface BanEntry {
        server_id: number;
        banid: number;

        name?: string;
        name_type?: number;

        unique_id?: string;
        ip?: string;
        hardware_id?: string;

        reason: string;
        invoker_name: string;
        invoker_unique_id?: string;
        invoker_database_id?: number;

        timestamp_created: Date;
        timestamp_expire: Date;

        enforcements: number;

        flag_own?: boolean;
    }
    export interface BanListManager {
        addbans : (ban: BanEntry[]) => void;
        clear : (ban?: any) => void;
    }

    export function openBanList(client: TSClient) {
        let update;
        const modal = spawnBanListModal(() => update(), () => {
            spawnBanCreate(undefined, result => {
                if(result.server_id < 0) result.server_id = undefined;
                console.log("Adding ban %o", result);

                client.serverConnection.sendCommand("banadd", {
                    ip: result.ip,
                    name: result.name,
                    uid: result.unique_id,
                    hwid: result.hardware_id,
                    banreason: result.reason,
                    time: result.timestamp_expire.getTime() > 0 ? (result.timestamp_expire.getTime() - result.timestamp_created.getTime()) / 1000 : 0,
                    sid: result.server_id
                }).then(() => {
                    update();
                }).catch(error => {
                    createErrorModal("Failed to add ban", "Failed to add ban.<br>Reason: " + (error instanceof CommandResult ? error.extra_message || error.message : error)).open();
                });
            });
        }, ban => {
            console.log("Editing ban %o", ban);
            spawnBanCreate(ban, result => {
                console.log("Apply edit changes %o", result);
                if(result.server_id < 0) result.server_id = undefined;

                client.serverConnection.sendCommand("banedit", {
                    banid: result.banid,
                    ip: result.ip,
                    name: result.name,
                    uid: result.unique_id,
                    hwid: result.hardware_id,
                    banreason: result.reason,
                    time: result.timestamp_expire.getTime() > 0 ? (result.timestamp_expire.getTime() - result.timestamp_created.getTime()) / 1000 : 0,
                    sid: result.server_id
                }).then(() => {
                    update();
                }).catch(error => {
                    createErrorModal("Failed to edit ban", "Failed to edit ban.<br>Reason: " + (error instanceof CommandResult ? error.extra_message || error.message : error)).open();
                });
            });
        }, ban => {
            console.log("Deleting ban %o", ban);
            client.serverConnection.sendCommand("bandel", {
                banid: ban.banid,
                sid: ban.server_id
            }).then(() => {
                update();
            }).catch(error => {
                createErrorModal("Failed to delete ban", "Failed to delete ban.<br>Reason: " + (error instanceof CommandResult ? error.extra_message || error.message : error)).open();
            });
        });

        update = () => {
            client.serverConnection.commandHandler["notifybanlist"] = json => {
                console.log("Got banlist: ", json);

                let bans: BanEntry[] = [];
                for(const entry of json) {
                    /*
                    notify[index]["sid"] = elm->serverId;
                    notify[index]["banid"] = elm->banId;
                    if(allow_ip)
                        notify[index]["ip"] = elm->ip;
                    else
                        notify[index]["ip"] = "hidden";
                    notify[index]["name"] = elm->name;
                    notify[index]["uid"] = elm->uid;
                    notify[index]["lastnickname"] = elm->name; //Maybe update?

                    notify[index]["created"] = chrono::duration_cast<chrono::seconds>(elm->created.time_since_epoch()).count();
                    if (elm->until.time_since_epoch().count() != 0)
                    notify[index]["duration"] = chrono::duration_cast<chrono::seconds>(elm->until - elm->created).count();
                    else
                    notify[index]["duration"] = 0;

                    notify[index]["reason"] = elm->reason;
                    notify[index]["enforcements"] = elm->triggered;

                    notify[index]["invokername"] = elm->invokerName;
                    notify[index]["invokercldbid"] = elm->invokerDbId;
                    notify[index]["invokeruid"] = elm->invokerUid;
                    */
                    bans.push({
                        server_id: parseInt(entry["sid"]),
                        banid: parseInt(entry["banid"]),
                        ip: entry["ip"],
                        name: entry["name"],
                        unique_id: entry["uid"],
                        hardware_id: entry["hwid"],

                        timestamp_created: new Date(parseInt(entry["created"]) * 1000),
                        timestamp_expire: new Date(parseInt(entry["duration"]) > 0 ? parseInt(entry["created"]) * 1000 + parseInt(entry["duration"]) * 1000 : 0),

                        invoker_name: entry["invokername"],
                        invoker_database_id: parseInt(entry["invokercldbid"]),
                        invoker_unique_id: entry["invokeruid"],
                        reason: entry["reason"],

                        enforcements: parseInt(entry["enforcements"]),
                        flag_own: entry["invokeruid"] == client.getClient().properties.client_unique_identifier
                    });
                }

                modal.addbans(bans);
            };

            //TODO test permission
            modal.clear();
            client.serverConnection.sendCommand("banlist", { sid: 0 }); //Global ban list
            client.serverConnection.sendCommand("banlist").catch(error => {
                if(error instanceof CommandResult) {
                } else {
                    console.error(error);
                }
            });
        };

        update();
    }

    export function spawnBanListModal(callback_update: () => any, callback_add: () => any, callback_edit: (entry: BanEntry) => any, callback_delete: (entry: BanEntry) => any) : BanListManager {
        let result: BanListManager = {} as any;

        let entries: BanEntry[] = [];
        const _callback_edit = ban_id => {
            for(const entry of entries)
                if(entry.banid == ban_id) {
                    callback_edit(entry);
                    return;
                }
            console.warn("Missing ban entry with id " + ban_id);
        };

        const _callback_delete = ban_id => {
            for (const entry of entries)
                if (entry.banid == ban_id) {
                    callback_delete(entry);
                    return;
                }
            console.warn("Missing ban entry with id " + ban_id);
        };

        let update_function: () => any;
        let modal: Modal;
        modal = createModal({
            header: "Banlist",
            body: () => {
                let template = $("#tmpl_ban_list").renderTag();
                template = $.spawn("div").append(template);

                apply_filter(template.find(".entry-filter"), template.find(".filter-flag-force-own"), template.find(".filter-flag-highlight-own"), template.find(".ban-entry-list"));
                update_function = apply_buttons(template.find(".manage-buttons"), template.find(".ban-entry-list"), callback_add, _callback_edit, _callback_delete);
                template.find(".button-close").on('click', _ => modal.close());
                template.find(".button-refresh").on('click', () => callback_update());
                return template;
            },
            footer: undefined,
            width: "80%",
            height: "80%"
        });
        modal.open();
        modal.close_listener.push(() => entries = []);

        result.addbans = (bans: BanEntry[]) => {
            for(const entry of bans) {
                entries.push(entry);
                $("#tmpl_ban_entry").renderTag(entry).appendTo(modal.htmlTag.find(".ban-entry-list"));
            }
            modal.htmlTag.find(".entry-filter").trigger("change");
            update_function();
        };
        result.clear = () => {
            entries = [];
            modal.htmlTag.find(".ban-entry-list").children().detach();
            update_function();
        };

        return result;
    }

    function apply_filter(input: JQuery, show_own_bans: JQuery, highlight_own_bans: JQuery, elements: JQuery) {
        input.on('keyup change', event => {
            const filter = (input.val() as string).trim();
            const show_own_only = show_own_bans.prop("checked");
            const highlight_own = highlight_own_bans.prop("checked");

            console.log("Search for filter %s", filter);

            let shown = 0, hidden = 0;
            elements.find(".ban-entry").each((_idx, _entry) => {
                const entry = $(_entry);
                if(entry.hasClass("ban-entry-own")) {
                    if(highlight_own)
                        entry.addClass("ban-entry-own-bold");
                    else
                        entry.removeClass("ban-entry-own-bold");

                } else if(show_own_only) {
                    if(entry.hide().hasClass("selected"))
                        entry.trigger("click");
                    hidden++;
                    return;
                }
                if(filter.length == 0 || entry.text().indexOf(filter) > 0) {
                    entry.show();
                    shown++;
                } else {
                    if(entry.hide().hasClass("selected"))
                        entry.trigger("click");
                    hidden++;
                }
            });

            $(".entry-count-info").text((shown + hidden) + " entries. " + shown + " entries shown");
        });
        show_own_bans.on('click', () => input.trigger('change'));
        highlight_own_bans.on('click', () => input.trigger('change'));
    }

    function apply_buttons(tag: JQuery, elements: JQuery, cb_add: () => any, cb_edit: (id: number) => any, cb_delete: (id: number) => any) : () => any {
        const update = () => {
            console.log(elements.find("tr.selected").length);
            $(".button-edit, .button-remove").prop("disabled", elements.find("tr.selected").length == 0);
        };

        tag.find(".button-add").on('click', event => cb_add());
        tag.find(".button-edit").on('click', event => {
            const selected = elements.find("tr.selected");
            if(!selected) return;
            cb_edit(parseInt(selected.attr("ban-id")));
        });
        tag.find(".button-remove").on('click', event => {
            const selected = elements.find("tr.selected");
            if(!selected) return;
            cb_delete(parseInt(selected.attr("ban-id")));
        });

        const element_selected = element => {
            elements.find("tr").removeClass("selected");
            if(element.is(":visible"))
                element.addClass("selected");

            update();
        };

        const click_handler = event => element_selected($(event.currentTarget));
        const context_handler = event => {
            const element = $(event.currentTarget);
            element_selected(element);

            event.preventDefault();

            spawn_context_menu(event.pageX, event.pageY, {
                name: "Edit",
                type: MenuEntryType.ENTRY,
                callback: () => cb_edit(parseInt(element.attr("ban-id")))
            }, {
                name: "Delete",
                type: MenuEntryType.ENTRY,
                callback: () => cb_delete(parseInt(element.attr("ban-id")))
            });
        };

        return () => {
            elements.find("tr").each((_idx, _entry) => {
                _entry.addEventListener("click", click_handler);
                _entry.addEventListener("contextmenu", context_handler)
            });
            update();
        };
    }
}

/*
   <tr class="ban-entry">
        <td class="field-properties">
            <a class="property property-name">name=WolverasdasdinDEV</a>
            <a class="property property-ip">ip=WolverasdasdinDEV</a>
            <a class="property property-unique-id">uid=WolverasdasdinDEV</a>
            <a class="property property-hardware-id">hwid=WolverasdasdinDEV</a>
        </td>
        <td class="field-reason">Insult</td>
        <td class="field-invoker">WolverinDEV</td>
        <td class="field-timestamp">
            <a class="timestamp-created">Created: 1.1.2013 12:22</a>
            <a class="timestamp-expires">Expires: 1.21.2013 12:22</a>
        </td>
    </tr>
 */