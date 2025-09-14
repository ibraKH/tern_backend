export interface StateData {
    state_id: number;
    state_name: string;
    vast_state: {
        vast_class: string;
        vast_name: string;
        vast_eks_state: number;
        eks_overstorey_class: string;
        eks_understorey_class: string;
        eks_substate: string;
        link: string;
    };
    condition_upper: number;
    condition_lower: number;
    eks_condition_estimate: number;
    elicitation_type: string;
    attributes: any;
}

export interface TransitionData {
    transition_id: number;
    stm_name: string;
    start_state: string;
    start_state_id: number;
    end_state: string;
    end_state_id: number;
    time_25: number;
    time_100: number;
    likelihood_25: number;
    likelihood_100: number;
    notes: string;
    causal_chain: any[];
    transition_delta: number;
}

export interface BMRGData {
    stm_name: string;
    version: string;
    release_date: string;
    authorised_by: string;
    contributing_experts: any[];
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
    method_alignment: string;
}