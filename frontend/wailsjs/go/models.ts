export namespace annotation {
	
	export class Annotation {
	    layer: string;
	    fid: number;
	    record_id: string;
	    record_name: string;
	    lon?: number;
	    lat?: number;
	    category: string;
	    first_category: string;
	    reference_label: string;
	    notes: string;
	    annotator: string;
	    created_at: string;
	    updated_at: string;
	    revision: number;
	
	    static createFrom(source: any = {}) {
	        return new Annotation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layer = source["layer"];
	        this.fid = source["fid"];
	        this.record_id = source["record_id"];
	        this.record_name = source["record_name"];
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.category = source["category"];
	        this.first_category = source["first_category"];
	        this.reference_label = source["reference_label"];
	        this.notes = source["notes"];
	        this.annotator = source["annotator"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.revision = source["revision"];
	    }
	}
	export class Category {
	    id: string;
	    label: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new Category(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	    }
	}
	export class Draft {
	    layer: string;
	    fid: number;
	    category: string;
	    reference_label: string;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new Draft(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layer = source["layer"];
	        this.fid = source["fid"];
	        this.category = source["category"];
	        this.reference_label = source["reference_label"];
	        this.notes = source["notes"];
	    }
	}
	export class Image {
	    id: number;
	    layer: string;
	    fid: number;
	    side: string;
	    path: string;
	    sha256: string;
	    bytes: number;
	    width?: number;
	    height?: number;
	    origin: string;
	    detail: string;
	    captured_at: string;
	
	    static createFrom(source: any = {}) {
	        return new Image(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.layer = source["layer"];
	        this.fid = source["fid"];
	        this.side = source["side"];
	        this.path = source["path"];
	        this.sha256 = source["sha256"];
	        this.bytes = source["bytes"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.origin = source["origin"];
	        this.detail = source["detail"];
	        this.captured_at = source["captured_at"];
	    }
	}
	export class Entry {
	    annotation?: Annotation;
	    source_image?: Image;
	    reference_image?: Image;
	    revisions: number;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.annotation = this.convertValues(source["annotation"], Annotation);
	        this.source_image = this.convertValues(source["source_image"], Image);
	        this.reference_image = this.convertValues(source["reference_image"], Image);
	        this.revisions = source["revisions"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HistoryEntry {
	    revision: number;
	    category: string;
	    reference_label: string;
	    notes: string;
	    annotator: string;
	    source_image_id?: number;
	    reference_image_id?: number;
	    saved_at: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.revision = source["revision"];
	        this.category = source["category"];
	        this.reference_label = source["reference_label"];
	        this.notes = source["notes"];
	        this.annotator = source["annotator"];
	        this.source_image_id = source["source_image_id"];
	        this.reference_image_id = source["reference_image_id"];
	        this.saved_at = source["saved_at"];
	    }
	}
	
	export class LayerSettings {
	    name_column: string;
	    id_column: string;
	    info_columns: string[];
	    hidden_columns: string[];
	
	    static createFrom(source: any = {}) {
	        return new LayerSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name_column = source["name_column"];
	        this.id_column = source["id_column"];
	        this.info_columns = source["info_columns"];
	        this.hidden_columns = source["hidden_columns"];
	    }
	}
	export class Settings {
	    annotator: string;
	    categories: Category[];
	    layers: Record<string, LayerSettings>;
	    seed: number;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.annotator = source["annotator"];
	        this.categories = this.convertValues(source["categories"], Category);
	        this.layers = this.convertValues(source["layers"], LayerSettings, true);
	        this.seed = source["seed"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Source {
	    path: string;
	    sha256: string;
	    bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Source(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.sha256 = source["sha256"];
	        this.bytes = source["bytes"];
	    }
	}
	export class Info {
	    dir: string;
	    name: string;
	    created_at: string;
	    source: Source;
	    source_status: string;
	    current_sha256: string;
	    settings: Settings;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.name = source["name"];
	        this.created_at = source["created_at"];
	        this.source = this.convertValues(source["source"], Source);
	        this.source_status = source["source_status"];
	        this.current_sha256 = source["current_sha256"];
	        this.settings = this.convertValues(source["settings"], Settings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class Summary {
	    fid: number;
	    category: string;
	    saved: boolean;
	    has_source_image: boolean;
	    has_reference_image: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fid = source["fid"];
	        this.category = source["category"];
	        this.saved = source["saved"];
	        this.has_source_image = source["has_source_image"];
	        this.has_reference_image = source["has_reference_image"];
	    }
	}

}

export namespace exports {
	
	export class LayerResult {
	    layer: string;
	    records: number;
	    revisions: number;
	    without_position: number;
	
	    static createFrom(source: any = {}) {
	        return new LayerResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layer = source["layer"];
	        this.records = source["records"];
	        this.revisions = source["revisions"];
	        this.without_position = source["without_position"];
	    }
	}
	export class Result {
	    dir: string;
	    files: string[];
	    layers: LayerResult[];
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.files = source["files"];
	        this.layers = this.convertValues(source["layers"], LayerResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace gpkg {
	
	export class BBox {
	    min_x: number;
	    min_y: number;
	    max_x: number;
	    max_y: number;
	
	    static createFrom(source: any = {}) {
	        return new BBox(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.min_x = source["min_x"];
	        this.min_y = source["min_y"];
	        this.max_x = source["max_x"];
	        this.max_y = source["max_y"];
	    }
	}
	export class Column {
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new Column(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class Geometry {
	    type: string;
	    coordinates?: any;
	    geometries?: Geometry[];
	
	    static createFrom(source: any = {}) {
	        return new Geometry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.coordinates = source["coordinates"];
	        this.geometries = this.convertValues(source["geometries"], Geometry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Feature {
	    type: string;
	    id: number;
	    geometry: Geometry;
	    properties: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Feature(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.id = source["id"];
	        this.geometry = this.convertValues(source["geometry"], Geometry);
	        this.properties = source["properties"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FeatureCollection {
	    type: string;
	    features: Feature[];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FeatureCollection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.features = this.convertValues(source["features"], Feature);
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Layer {
	    name: string;
	    title: string;
	    description: string;
	    geometry_column: string;
	    geometry_type: string;
	    srs: string;
	    primary_key: string;
	    columns: Column[];
	    feature_count: number;
	    spatial_index: boolean;
	    problem: string;
	
	    static createFrom(source: any = {}) {
	        return new Layer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.geometry_column = source["geometry_column"];
	        this.geometry_type = source["geometry_type"];
	        this.srs = source["srs"];
	        this.primary_key = source["primary_key"];
	        this.columns = this.convertValues(source["columns"], Column);
	        this.feature_count = source["feature_count"];
	        this.spatial_index = source["spatial_index"];
	        this.problem = source["problem"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Row {
	    fid: number;
	    position?: number[];
	    values: any[];
	
	    static createFrom(source: any = {}) {
	        return new Row(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fid = source["fid"];
	        this.position = source["position"];
	        this.values = source["values"];
	    }
	}
	export class Table {
	    layer: string;
	    columns: Column[];
	    rows: Row[];
	
	    static createFrom(source: any = {}) {
	        return new Table(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layer = source["layer"];
	        this.columns = this.convertValues(source["columns"], Column);
	        this.rows = this.convertValues(source["rows"], Row);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class LayerSummary {
	    name: string;
	    title: string;
	    description: string;
	    geometry_column: string;
	    geometry_type: string;
	    srs: string;
	    primary_key: string;
	    columns: gpkg.Column[];
	    feature_count: number;
	    spatial_index: boolean;
	    problem: string;
	    points: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LayerSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.geometry_column = source["geometry_column"];
	        this.geometry_type = source["geometry_type"];
	        this.srs = source["srs"];
	        this.primary_key = source["primary_key"];
	        this.columns = this.convertValues(source["columns"], gpkg.Column);
	        this.feature_count = source["feature_count"];
	        this.spatial_index = source["spatial_index"];
	        this.problem = source["problem"];
	        this.points = source["points"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NearRecord {
	    layer: string;
	    fid: number;
	    title: string;
	    meters: number;
	
	    static createFrom(source: any = {}) {
	        return new NearRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layer = source["layer"];
	        this.fid = source["fid"];
	        this.title = source["title"];
	        this.meters = source["meters"];
	    }
	}
	export class NewProject {
	    dir: string;
	    name: string;
	    source_path: string;
	    annotator: string;
	
	    static createFrom(source: any = {}) {
	        return new NewProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.name = source["name"];
	        this.source_path = source["source_path"];
	        this.annotator = source["annotator"];
	    }
	}
	export class ProjectState {
	    info: annotation.Info;
	    layers: gpkg.Layer[];
	    source_error: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.info = this.convertValues(source["info"], annotation.Info);
	        this.layers = this.convertValues(source["layers"], gpkg.Layer);
	        this.source_error = source["source_error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RecentProject {
	    dir: string;
	    name: string;
	    opened_at: string;
	    exists: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RecentProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.name = source["name"];
	        this.opened_at = source["opened_at"];
	        this.exists = source["exists"];
	    }
	}

}

