import {ReactComponentBase} from "tc-shared/ui/react-elements/ReactComponentBase";
import * as React from "react";
import {RDPEntry} from "tc-shared/ui/tree/RendererDataProvider";

const viewStyle = require("./View.scss");

export class UnreadMarkerRenderer extends React.Component<{ entry: RDPEntry }, {}> {
    render() {
        if(this.props.entry.unread) {
            return <div className={viewStyle.markerUnread} key={"unread-marker"} />;
        } else {
            return null;
        }
    }
}

export class RendererTreeEntry<Props, State> extends ReactComponentBase<Props, State> { }