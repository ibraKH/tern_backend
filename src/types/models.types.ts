export type ChainPart =
  | 'Management Intervention'
  | 'Favorable abiotic factor'
  | 'Biotic process'
  | 'Hazard';

export type ContributionType = 'Author' | 'Reviewer';

export interface VastState {
  vast_state_id?: number;              
  vast_class?: string;
  vast_name?: string;
  vast_eks_state?: number | null;
  eks_overstorey_class?: string | null;
  eks_understorey_class?: string | null;
  eks_substate?: string | null;
  link?: string | null;
}

export interface StateAttribute {
  state_attribute_id?: number;        
  attribute_type: string;           
  value: number | string;          
  units?: string | null;
}

export interface StateData {
    state_id?: number;
    frontend_state_id?: number;
    state_name: string;
    vast_state: VastState;
    condition_upper: number | null;
    condition_lower: number | null;
    eks_condition_estimate: number | null;
    elicitation_type?: 'Pilot region' | 'NEAP estimate';
    node_x?: number | null;
    node_y?: number | null;
    attributes: StateAttribute[];
}

export interface ChainDriver {
  driver_id?: number;                  
  driver: string;
  description?: string | null;
  driver_group?: string | null;
}

export interface CausalChain {
  causal_chain_id?: number;            
  name?: string;
  chain_part?: ChainPart;
  drivers?: ChainDriver[];
}

export interface TransitionData {
    id?: number;
    transition_id?: number | null;
    stm_name?: string;
    start_state?: string;
    start_state_id: number;
    end_state?: string;
    end_state_id: number;
    time_25?: number | null;
    time_100?: number | null;
    likelihood_25?: number | null;
    likelihood_100?: number | null;
    notes?: string | null;
    causal_chain: CausalChain[];
    transition_delta?: number | null;
}

export interface Contributor {
  contributor_id?: number;
  name: string;
  email: string;
  contribution_type: ContributionType;
}

export interface BMRGData {
    id?: number;
    stm_name: string;
    version: string;
    release_date: string;
    authorised_by: string;
    contributing_experts: Contributor[];
    region: string;
    region_id: number;
    climate: string;
    ecosystem_type: string;
    aus_eco_archetype_code: number;
    aus_eco_archetype_name: string;
    aus_eco_umbrella_code: number;
    peer_reviewed: string;
    no_peer_reviewers: number;
    states: StateData[];
    transitions: TransitionData[];
    method_alignment?: string | null;
    is_template?: boolean;
}